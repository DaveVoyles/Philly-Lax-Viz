export interface CorrectionTarget {
  entityType: 'player_stat' | 'game';
  entityId: number;
  fieldName: string;
  fieldLabel: string;
  currentValue: number;
  contextLabel: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HIGH_PLAYER_FIELDS = new Set(['goals', 'assists']);
const HIGH_SCORE_FIELDS = new Set(['home_score', 'away_score']);
const ENV = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

let correctionModalCssInjected = false;

export function openCorrectionModal(target: CorrectionTarget): void {
  ensureCorrectionModalCss();

  document.getElementById('correction-modal-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'correction-modal-overlay';
  overlay.className = 'correction-modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'correction-modal';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'correction-close';
  closeButton.setAttribute('aria-label', 'Close correction modal');
  closeButton.textContent = '×';

  const heading = document.createElement('h2');
  heading.className = 'correction-title';
  heading.textContent = 'Suggest a correction';

  const context = document.createElement('div');
  context.className = 'correction-context';

  const field = document.createElement('span');
  field.className = 'correction-field';
  field.textContent = target.fieldLabel;

  const current = document.createElement('span');
  current.className = 'correction-current';
  current.textContent = `Current value: ${target.currentValue}`;

  const game = document.createElement('span');
  game.className = 'correction-game';
  game.textContent = target.contextLabel;

  context.append(field, current, game);

  const formWrap = document.createElement('div');
  formWrap.className = 'correction-form-wrap';

  const fields = document.createElement('div');
  fields.className = 'correction-fields';

  const firstName = createInputField('First Name', 'text');
  firstName.input.required = true;
  firstName.input.autocomplete = 'given-name';

  const lastName = createInputField('Last Name', 'text');
  lastName.input.required = true;
  lastName.input.autocomplete = 'family-name';

  const email = createInputField('Email', 'email');
  email.input.required = true;
  email.input.autocomplete = 'email';
  email.input.inputMode = 'email';

  const proposedValue = createInputField('Proposed Value', 'number');
  proposedValue.input.required = true;
  proposedValue.input.min = '0';
  proposedValue.input.max = '999';
  proposedValue.input.step = '1';
  proposedValue.input.value = String(target.currentValue);

  const note = createTextAreaField('Note');
  note.input.maxLength = 500;
  note.input.placeholder = 'Optional: explain the correction';

  fields.append(
    firstName.wrapper,
    lastName.wrapper,
    email.wrapper,
    proposedValue.wrapper,
    note.wrapper,
    createHiddenInput('entityType', target.entityType),
    createHiddenInput('entityId', String(target.entityId)),
    createHiddenInput('fieldName', target.fieldName),
  );

  const warning = document.createElement('div');
  warning.className = 'correction-warning';
  warning.hidden = true;

  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'correction-submit';
  submit.textContent = 'Submit correction';

  const message = document.createElement('div');
  message.className = 'correction-message';
  message.setAttribute('aria-live', 'polite');

  const noteText = document.createElement('p');
  noteText.className = 'correction-note';
  noteText.textContent = 'Corrections are reviewed nightly before being applied.';

  formWrap.append(fields, warning, submit, message, noteText);
  modal.append(closeButton, heading, context, formWrap);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const dismiss = (): void => {
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') dismiss();
  };

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) dismiss();
  });
  closeButton.addEventListener('click', dismiss);
  document.addEventListener('keydown', onKeyDown);

  proposedValue.input.addEventListener('input', () => {
    const nextValue = Number.parseInt(proposedValue.input.value, 10);
    const nextWarning = getOutlierWarning(target.fieldName, nextValue);
    warning.hidden = !nextWarning;
    warning.textContent = nextWarning ?? '';
  });
  proposedValue.input.dispatchEvent(new Event('input'));

  const setMessage = (text: string, kind: 'error' | 'success'): void => {
    message.textContent = text;
    message.className = `correction-message ${kind}`;
  };

  submit.addEventListener('click', () => {
    void submitCorrection({
      target,
      firstName: firstName.input,
      lastName: lastName.input,
      email: email.input,
      proposedValue: proposedValue.input,
      note: note.input,
      submit,
      setMessage,
      formWrap,
    });
  });

  firstName.input.focus();
}

async function submitCorrection(args: {
  target: CorrectionTarget;
  firstName: HTMLInputElement;
  lastName: HTMLInputElement;
  email: HTMLInputElement;
  proposedValue: HTMLInputElement;
  note: HTMLTextAreaElement;
  submit: HTMLButtonElement;
  setMessage: (text: string, kind: 'error' | 'success') => void;
  formWrap: HTMLDivElement;
}): Promise<void> {
  const submitterFirst = args.firstName.value.trim();
  const submitterLast = args.lastName.value.trim();
  const submitterEmail = args.email.value.trim();
  const proposedValue = Number.parseInt(args.proposedValue.value, 10);

  if (!submitterFirst || !submitterLast) {
    args.setMessage('Please enter your first and last name.', 'error');
    return;
  }
  if (!EMAIL_RE.test(submitterEmail)) {
    args.setMessage('Please enter a valid email address.', 'error');
    return;
  }
  if (!Number.isInteger(proposedValue) || proposedValue < 0) {
    args.setMessage('Please enter a whole number that is 0 or greater.', 'error');
    return;
  }

  const originalLabel = args.submit.textContent ?? 'Submit correction';
  args.submit.disabled = true;
  args.submit.textContent = 'Submitting...';

  const apiBase = ENV.VITE_API_URL ?? '';

  try {
    const response = await fetch(`${apiBase}/api/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submitterFirst,
        submitterLast,
        submitterEmail,
        entityType: args.target.entityType,
        entityId: args.target.entityId,
        fieldName: args.target.fieldName,
        newValue: String(proposedValue),
        note: args.note.value.trim(),
      }),
    });

    if (response.status === 201) {
      const success = document.createElement('div');
      success.className = 'correction-success';
      success.textContent = '✅ Thank you! Your correction will be reviewed tonight.';
      args.formWrap.replaceChildren(success);
      return;
    }

    if (response.status === 429) {
      args.setMessage("You've submitted too many corrections today. Please try again tomorrow.", 'error');
      return;
    }

    args.setMessage('Something went wrong. Please try again.', 'error');
  } catch {
    args.setMessage('Something went wrong. Please try again.', 'error');
  } finally {
    if (document.body.contains(args.submit)) {
      args.submit.disabled = false;
      args.submit.textContent = originalLabel;
    }
  }
}

function getOutlierWarning(fieldName: string, proposedValue: number): string | null {
  if (!Number.isInteger(proposedValue)) return null;
  if (HIGH_PLAYER_FIELDS.has(fieldName) && proposedValue > 15) {
    return 'This value seems high - please double-check.';
  }
  if (HIGH_SCORE_FIELDS.has(fieldName) && proposedValue > 30) {
    return 'This value seems high - please double-check.';
  }
  return null;
}

function createInputField(labelText: string, type: string): {
  wrapper: HTMLLabelElement;
  input: HTMLInputElement;
} {
  const wrapper = document.createElement('label');
  wrapper.className = 'correction-label';
  wrapper.textContent = labelText;

  const input = document.createElement('input');
  input.type = type;
  input.className = 'correction-input';

  wrapper.appendChild(input);
  return { wrapper, input };
}

function createTextAreaField(labelText: string): {
  wrapper: HTMLLabelElement;
  input: HTMLTextAreaElement;
} {
  const wrapper = document.createElement('label');
  wrapper.className = 'correction-label';
  wrapper.textContent = labelText;

  const input = document.createElement('textarea');
  input.className = 'correction-input correction-textarea';
  input.rows = 4;

  wrapper.appendChild(input);
  return { wrapper, input };
}

function createHiddenInput(name: string, value: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = name;
  input.value = value;
  return input;
}

function ensureCorrectionModalCss(): void {
  if (correctionModalCssInjected) return;
  correctionModalCssInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .correction-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(17, 24, 39, 0.68);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      z-index: 9999;
    }
    .correction-modal {
      position: relative;
      width: min(100%, 420px);
      max-width: 420px;
      max-height: calc(100vh - 40px);
      overflow-y: auto;
      background: #ffffff;
      border-radius: 8px;
      padding: 24px;
      box-shadow: 0 20px 45px rgba(0, 0, 0, 0.22);
      color: #111827;
    }
    .correction-close {
      position: absolute;
      top: 10px;
      right: 10px;
      border: 0;
      background: transparent;
      color: #6b7280;
      font-size: 24px;
      line-height: 1;
      cursor: pointer;
    }
    .correction-title {
      margin: 0 0 16px;
      font-size: 1.25rem;
    }
    .correction-context {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 16px;
      padding: 12px;
      border-radius: 6px;
      background: #f3f4f6;
    }
    .correction-field {
      font-weight: 700;
    }
    .correction-current,
    .correction-game,
    .correction-note {
      color: #4b5563;
      font-size: 0.9rem;
    }
    .correction-fields {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .correction-label {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-weight: 600;
      color: #111827;
      font-size: 0.95rem;
    }
    .correction-input {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font: inherit;
      color: #111827;
      background: #ffffff;
    }
    .correction-textarea {
      resize: vertical;
      min-height: 96px;
    }
    .correction-submit {
      width: 100%;
      margin-top: 12px;
      border: 0;
      border-radius: 6px;
      padding: 12px 16px;
      background: #1a73e8;
      color: #ffffff;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    .correction-submit:disabled {
      cursor: wait;
      opacity: 0.7;
    }
    .correction-message {
      min-height: 20px;
      margin-top: 12px;
      font-size: 0.9rem;
    }
    .correction-message.error {
      color: #b91c1c;
    }
    .correction-message.success,
    .correction-success {
      color: #166534;
    }
    .correction-warning {
      margin-top: 12px;
      padding: 10px 12px;
      border-radius: 6px;
      background: #fef3c7;
      color: #92400e;
      font-size: 0.85rem;
    }
    .correction-note {
      margin: 12px 0 0;
    }
    .correction-success {
      padding: 16px 0 4px;
      font-size: 1rem;
      font-weight: 600;
    }
  `;
  document.head.appendChild(style);
}
