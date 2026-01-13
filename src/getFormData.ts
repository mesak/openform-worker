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
  DATE = 9,
  TIME = 10,
}

enum EmailCollectionRuleEnum {
  NONE = 1,
  VERIFIED = 2,
  INPUT = 3
}

export interface Form {
  title: string;
  description: string | null;
  collectEmails: "NONE" | "VERIFIED" | "INPUT";
  questions: Question[];
  error: false;
}

export interface Question {
  title: string;
  description: string | null;
  type: "TEXT" | "PARAGRAPH_TEXT" | "MULTIPLE_CHOICE" | "CHECKBOXES" | "DROPDOWN" | "DATE" | "TIME" | "SCALE" | "GRID" | "FILE_UPLOAD"
  options: string[];
  required: boolean;
  id: string;
}

export interface Error {
  error: true;
  message: string;
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

  const form: Form = {
    title,
    description,
    collectEmails: collectEmails as any,
    questions: [],
    error: false,
  };

  for (const field of arrayOfFields) {
    if (field.length < 4 || !(field[4]?.length)) {
      // console.log("Continue: Non Submittable field or field without answer was found"); // Logging removed for Worker cleanliness
      continue;
    }

    const questionText = field[1] as string;
    const questionDescription = field[2] as string;

    const questionTypeCodeValue = field[3];

    const questionTypeEnum = GoogleFormsFieldTypeEnum[questionTypeCodeValue];
    const questionType = questionTypeEnum?.toString();

    const answerOptionsList: string[] = [];
    const answerOptionsListValue = field[4]?.[0]?.[1] ?? [];

    if (answerOptionsListValue.length > 0) {
      for (const answerOption of answerOptionsListValue) {
        const option = answerOption[0]?.toString();
        if (option) {
          answerOptionsList.push(option);
        }
      }
    }

    const answerSubmissionId = field[4]?.[0]?.[0] as string;
    const isAnswerRequired = field[4]?.[0]?.[2] === 1;

    const question: Question = {
      title: questionText,
      description: questionDescription,
      type: questionType as any,
      options: answerOptionsList,
      required: isAnswerRequired,
      id: answerSubmissionId
    };

    form.questions.push(question);
  }

  return form;
}
