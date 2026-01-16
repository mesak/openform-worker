import * as cheerio from 'cheerio';

enum GoogleFormsFieldTypeEnum {
  TEXT = 0,
  PARAGRAPH_TEXT = 1,
  MULTIPLE_CHOICE = 2,
  DROPDOWN = 3,
  CHECKBOXES = 4,
  SCALE = 5,
  GRID = 7,
  FILE_UPLOAD = 8,
  SECTION_HEADER = 8,  // Same as FILE_UPLOAD, but used for sections
  DATE = 9,
  TIME = 10,
}

enum EmailCollectionRuleEnum {
  NONE = 1,
  VERIFIED = 2,
  INPUT = 3
}

// Navigation constants
const GO_TO_SUBMIT = -1;  // Special value meaning "submit form"

export interface QuestionOption {
  value: string;
  goToSection?: string | null;  // Section ID to navigate to, null means "continue to next"
}

export interface Question {
  title: string;
  description: string | null;
  type: "TEXT" | "PARAGRAPH_TEXT" | "MULTIPLE_CHOICE" | "CHECKBOXES" | "DROPDOWN" | "DATE" | "TIME" | "SCALE" | "GRID" | "FILE_UPLOAD";
  options: (string | QuestionOption)[];  // Can be simple strings or objects with navigation
  required: boolean;
  id: string;
}

export interface FormSection {
  id: string | null;  // Section ID, null for default/first section
  title: string | null;  // Section header title, null for default section
  questions: Question[];
}

export interface Form {
  title: string;
  description: string | null;
  collectEmails: "NONE" | "VERIFIED" | "INPUT";
  sections: FormSection[];  // New: organized by sections
  questions: Question[];  // Backward compatible: flat list of all submittable questions
  error: false;
}

export interface Error {
  error: true;
  message: string;
}

// Check if a field is a section header (type 8 with no submittable answer)
function isSectionHeader(field: any): boolean {
  const fieldType = field[3];
  const hasSubmittableAnswer = field[4] && field[4].length > 0 && field[4][0] !== null;
  // Section headers have type 8 and no submittable answer section
  return fieldType === 8 && !hasSubmittableAnswer;
}

// Parse options with navigation info
function parseOptionsWithNavigation(answerOptionsListValue: any[], hasNavigation: boolean): (string | QuestionOption)[] {
  const options: (string | QuestionOption)[] = [];

  for (const answerOption of answerOptionsListValue) {
    const optionText = answerOption[0]?.toString();
    if (!optionText) continue;

    const goToSectionId = answerOption[2];  // Navigation target

    if (hasNavigation && goToSectionId !== undefined) {
      // Has navigation data
      if (goToSectionId === null) {
        options.push({ value: optionText, goToSection: null });  // Continue to next
      } else if (goToSectionId === GO_TO_SUBMIT) {
        options.push({ value: optionText, goToSection: "SUBMIT" });  // Submit form
      } else {
        options.push({ value: optionText, goToSection: goToSectionId.toString() });
      }
    } else {
      // No navigation, simple string
      options.push(optionText);
    }
  }

  return options;
}

// Check if any option in a field has navigation
function fieldHasNavigation(answerOptionsListValue: any[]): boolean {
  return answerOptionsListValue.some(opt => opt[2] !== undefined && opt[2] !== null);
}

export async function getFormData(id: string): Promise<Form | Error> {
  const url = `https://docs.google.com/forms/d/e/${id}/viewform`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  if (!response.ok) {
    return {
      error: true,
      message: 'Unable to fetch the form. Check your form ID and try again.'
    }
  }

  const htmlContent = await response.text();

  let fbPublicLoadDataScript: string | undefined;

  // Try RegExp first - improved pattern to handle multiline and variations
  const regex = /FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\]);/;
  const match = htmlContent.match(regex);

  if (match && match[1]) {
    fbPublicLoadDataScript = match[1];
  } else {
    const $ = cheerio.load(htmlContent);
    const scriptTags = $('script');

    scriptTags.each((i: number, tag: any) => {
      const scriptContent = $(tag).html();
      if (scriptContent && scriptContent.includes('FB_PUBLIC_LOAD_DATA_')) {
        fbPublicLoadDataScript = scriptContent;
        return false;
      }
    });
  }

  let fbPublicJsScriptContentCleanedUp: string;

  // If we got it from RegExp, it might already be clean JSON.
  // If we got it from Cheerio, it's the full script content (var ... = [...];).

  if (match && match[1]) {
    fbPublicJsScriptContentCleanedUp = fbPublicLoadDataScript?.trim() || "";
  } else {
    // Cleaning logic for Cheerio method
    if (!fbPublicLoadDataScript) return { error: true, message: "Should not happen" }; // Type guard

    // Use RegExp to extract the JSON array safely from the script content
    // Pattern: FB_PUBLIC_LOAD_DATA_ = [ ... ];
    // We look for the array bracket structure.
    const jsonRegex = /FB_PUBLIC_LOAD_DATA_\s*=\s*(\[.+\])\s*;/s;
    const jsonMatch = fbPublicLoadDataScript.match(jsonRegex);

    if (jsonMatch && jsonMatch[1]) {
      fbPublicJsScriptContentCleanedUp = jsonMatch[1].trim();
    } else {
      // Fallback to original substring method if regex fails
      const beginIndex = fbPublicLoadDataScript.indexOf('[');
      const lastIndex = fbPublicLoadDataScript.lastIndexOf(';');
      fbPublicJsScriptContentCleanedUp = fbPublicLoadDataScript
        .substring(beginIndex, lastIndex)
        .trim();
    }
  }

  if (!fbPublicLoadDataScript) {
    return {
      error: true,
      message: 'Unable to find the script tag containing FB_PUBLIC_LOAD_DATA_'
    }
  }

  let jArray: any[];
  try {
    jArray = JSON.parse(fbPublicJsScriptContentCleanedUp);
  } catch (error) {
    return {
      error: true,
      message: 'The script data could not be parsed as JSON'
    }
  }

  const description = jArray[1]?.[0] ?? null;
  const title = jArray[3] ?? null;
  const collectEmailsCodeValue = jArray[1]?.[10]?.[6] ?? null;
  const collectEmailsEnum = EmailCollectionRuleEnum[collectEmailsCodeValue]
  const collectEmails = collectEmailsEnum?.toString() ?? "NONE";

  const arrayOfFields = jArray[1]?.[1] ?? [];

  // Build section map: sectionId -> FormSection
  const sectionMap = new Map<string, FormSection>();
  const sectionOrder: string[] = [];  // Track order of sections

  // Default section for questions before any section header
  const DEFAULT_SECTION_ID = "__default__";
  sectionMap.set(DEFAULT_SECTION_ID, {
    id: null,
    title: null,
    questions: []
  });
  sectionOrder.push(DEFAULT_SECTION_ID);

  // First pass: identify all section headers
  for (const field of arrayOfFields) {
    if (isSectionHeader(field)) {
      const sectionId = field[0]?.toString();
      const sectionTitle = field[1] as string;

      if (sectionId) {
        sectionMap.set(sectionId, {
          id: sectionId,
          title: sectionTitle,
          questions: []
        });
        sectionOrder.push(sectionId);
      }
    }
  }

  // Second pass: assign questions to sections
  let currentSectionId = DEFAULT_SECTION_ID;
  const flatQuestions: Question[] = [];  // For backward compatibility

  for (const field of arrayOfFields) {
    // Check if this is a section header - switch current section
    if (isSectionHeader(field)) {
      const sectionId = field[0]?.toString();
      if (sectionId && sectionMap.has(sectionId)) {
        currentSectionId = sectionId;
      }
      continue;  // Skip adding section headers as questions
    }

    // Skip non-submittable fields
    if (field.length < 4 || !(field[4]?.length)) {
      continue;
    }

    const questionText = field[1] as string;
    const questionDescription = field[2] as string;
    const questionTypeCodeValue = field[3];

    const questionTypeEnum = GoogleFormsFieldTypeEnum[questionTypeCodeValue];
    const questionType = questionTypeEnum?.toString();

    const answerOptionsListValue = field[4]?.[0]?.[1] ?? [];
    const hasNavigation = fieldHasNavigation(answerOptionsListValue);
    const answerOptionsList = parseOptionsWithNavigation(answerOptionsListValue, hasNavigation);

    const answerSubmissionId = field[4]?.[0]?.[0]?.toString() ?? "";
    const isAnswerRequired = field[4]?.[0]?.[2] === 1;

    const question: Question = {
      title: questionText,
      description: questionDescription,
      type: questionType as any,
      options: answerOptionsList,
      required: isAnswerRequired,
      id: answerSubmissionId
    };

    // Add to current section
    const currentSection = sectionMap.get(currentSectionId);
    if (currentSection) {
      currentSection.questions.push(question);
    }

    // Also add to flat list for backward compatibility
    flatQuestions.push(question);
  }

  // Build sections array in order, filtering out empty sections
  const sections: FormSection[] = [];
  for (const sectionId of sectionOrder) {
    const section = sectionMap.get(sectionId);
    if (section && section.questions.length > 0) {
      sections.push(section);
    }
  }

  // If no sections with questions, create default section with all questions
  if (sections.length === 0 && flatQuestions.length > 0) {
    sections.push({
      id: null,
      title: null,
      questions: flatQuestions
    });
  }

  const form: Form = {
    title,
    description,
    collectEmails: collectEmails as any,
    sections,
    questions: flatQuestions,  // Backward compatible flat list
    error: false,
  };

  return form;
}
