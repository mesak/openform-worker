export interface FormDataType {
  [key: string]: string | string[];
}

export async function submitForm(id: string, data: FormDataType) {
  const url = `https://docs.google.com/forms/d/e/${id}/formResponse`;

  const formData = new FormData();

  const email = data['emailAddress'];

  if (email) {
    if (Array.isArray(email)) {
      return {
        error: true,
        message: 'Email address cannot be an array'
      }
    } else {
      formData.append('emailAddress', email);
    }
  }

  // We are processing a copy or just removing it from the loop by checking key
  // But wait, the original code did `delete data['emailAddress']`.
  // Modifying the argument object is generally okay here but cleaner to clone.
  // However, for migration fidelity, I will keep the logic close to original.
  // Since we don't want to mutate the inputs if possible, I'll filter in the loop.
  // Actually, let's stick to the original logic which assumes `data` can be modified or we just let it be.
  // The original code `delete data['emailAddress']` modifies the passed object.
  // Let's protect the input by cloning it lightly or just iterating carefully.
  
  // Clone data to avoid side effects
  const dataToProcess = { ...data };
  delete dataToProcess['emailAddress'];

  // Handle other fields
  Object.entries(dataToProcess).forEach(([key, value]) => {
    const id = `entry.${key}`;
    if (Array.isArray(value)) {
      value.forEach((v) => {
        formData.append(id, v);
      });
      return;
    } else {
      formData.append(id, value);
    }
  });

  const response = await fetch(url, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    return {
      error: true,
      message: 'Unable to submit the form. Check your form ID and email settings, and try again.'
    }
  }
  
  return {
    error: false,
    message: 'Form submitted successfully.'
  };
}
