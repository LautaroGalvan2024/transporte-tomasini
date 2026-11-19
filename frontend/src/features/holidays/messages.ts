export const holidayMessageOf = (error: unknown) =>
  error instanceof Error ? error.message : "No pudimos completar la acción.";
