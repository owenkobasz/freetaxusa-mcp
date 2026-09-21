export interface FormField {
  label: string;
  value: string;
  type: 'text' | 'select' | 'radio' | 'checkbox' | 'currency';
  required: boolean;
  options?: string[];
}

export interface SessionStatus {
  active: boolean;
  taxYear: string | null;
  currentSection: string | null;
  currentSid: number | null;
}
