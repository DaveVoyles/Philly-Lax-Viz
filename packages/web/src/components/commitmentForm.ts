/**
 * Self-service commitment submission form with a WebGL-style canvas
 * particle background for visual flair. Players enter their info
 * and it posts to the API.
 */

import type { CommitmentSelfSubmission } from '@pll/shared';
import { submitSelfCommitment } from '../api.js';

const POSITIONS: CommitmentSelfSubmission['position'][] = [
  'Attack',
  'Midfield',
  'LSM',
  'Defense',
  'Goalie',
];

const DIVISIONS: CommitmentSelfSubmission['division'][] = [
  'D1',
  'D2',
  'D3',
  'JUCO',
  'MCLA',
];

// ──────────────────────────────────────────────────────
// WebGL-style particle canvas background for the form
// ──────────────────────────────────────────────────────

interface FormParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  hue: number;
  alpha: number;
}

function mountFormCanvas(container: HTMLElement): void {
  const canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;border-radius:inherit;';
  container.style.position = 'relative';
  container.insertBefore(canvas, container.firstChild);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const particles: FormParticle[] = [];
  const PARTICLE_COUNT = 35;
  let w = 0;
  let h = 0;

  function resize(): void {
    const rect = container.getBoundingClientRect();
    w = rect.width;
    h = rect.height;
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    ctx!.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  function seed(): void {
    particles.length = 0;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        size: Math.random() * 2.5 + 1,
        hue: 190 + Math.random() * 30,
        alpha: Math.random() * 0.35 + 0.1,
      });
    }
  }

  function draw(): void {
    ctx!.clearRect(0, 0, w, h);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;
      ctx!.beginPath();
      ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx!.fillStyle = `hsla(${p.hue}, 90%, 65%, ${p.alpha})`;
      ctx!.fill();
    }

    // Draw faint connecting lines between nearby particles
    for (let i = 0; i < particles.length; i++) {
      const pi = particles[i];
      for (let j = i + 1; j < particles.length; j++) {
        const pj = particles[j];
        if (!pi || !pj) continue;
        const dx = pi.x - pj.x;
        const dy = pi.y - pj.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 100) {
          ctx!.beginPath();
          ctx!.moveTo(pi.x, pi.y);
          ctx!.lineTo(pj.x, pj.y);
          ctx!.strokeStyle = `hsla(195, 80%, 60%, ${0.12 * (1 - dist / 100)})`;
          ctx!.lineWidth = 0.5;
          ctx!.stroke();
        }
      }
    }

    requestAnimationFrame(draw);
  }

  const ro = new ResizeObserver(() => {
    resize();
    if (particles.length === 0) seed();
  });
  ro.observe(container);
  resize();
  seed();
  draw();
}

// ──────────────────────────────────────────────────────
// Form builder
// ──────────────────────────────────────────────────────

export function renderCommitmentForm(root: HTMLElement): HTMLElement {
  const wrapper = document.createElement('section');
  wrapper.style.cssText = `
    margin: 2.5rem 0;
    padding: 2rem 1.5rem;
    border-radius: 16px;
    border: 1px solid var(--border);
    background: linear-gradient(135deg, rgba(0,212,255,0.04) 0%, rgba(0,100,200,0.06) 100%);
    overflow: hidden;
  `;

  // Mount the particle canvas background
  mountFormCanvas(wrapper);

  const title = document.createElement('h2');
  title.textContent = 'Submit Your Commitment';
  title.style.cssText = 'position:relative;z-index:1;margin:0 0 0.25rem;font-size:1.4rem;';
  wrapper.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'muted';
  subtitle.style.cssText = 'position:relative;z-index:1;margin:0 0 1.5rem;';
  subtitle.textContent = 'Congrats on committing! Share the news with the Philly lacrosse community.';
  wrapper.appendChild(subtitle);

  const form = document.createElement('form');
  form.style.cssText = `
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  `;

  form.appendChild(buildField('firstName', 'First Name', 'text', true));
  form.appendChild(buildField('lastName', 'Last Name', 'text', true));
  form.appendChild(buildSelectField('position', 'Position', POSITIONS, true));
  form.appendChild(buildField('highSchool', 'High School', 'text', true));
  form.appendChild(buildField('college', 'College', 'text', true));
  form.appendChild(buildSelectField('division', 'Division', DIVISIONS, true));

  // Status field spans full width
  const statusField = buildSelectField('status', 'Commitment Status', ['verbal', 'committed', 'signed'], false);
  statusField.style.gridColumn = '1 / -1';
  form.appendChild(statusField);

  // Submit button spans full width
  const btnWrap = document.createElement('div');
  btnWrap.style.cssText = 'grid-column: 1 / -1; display:flex; justify-content:center; margin-top:0.5rem;';
  const btn = document.createElement('button');
  btn.type = 'submit';
  btn.textContent = 'Submit Commitment';
  btn.style.cssText = `
    padding: 0.75rem 2rem;
    border: none;
    border-radius: 10px;
    background: linear-gradient(135deg, #00d4ff 0%, #0080c0 100%);
    color: #000;
    font-weight: 700;
    font-size: 1rem;
    cursor: pointer;
    transition: transform 0.15s, box-shadow 0.15s;
    box-shadow: 0 2px 12px rgba(0,212,255,0.25);
  `;
  btn.addEventListener('mouseenter', () => {
    btn.style.transform = 'scale(1.04)';
    btn.style.boxShadow = '0 4px 20px rgba(0,212,255,0.45)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.transform = '';
    btn.style.boxShadow = '0 2px 12px rgba(0,212,255,0.25)';
  });
  btnWrap.appendChild(btn);
  form.appendChild(btnWrap);

  // Feedback area
  const feedback = document.createElement('div');
  feedback.style.cssText = 'grid-column: 1 / -1; min-height:1.5rem;';
  form.appendChild(feedback);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void handleSubmit(form, btn, feedback);
  });

  wrapper.appendChild(form);
  root.appendChild(wrapper);
  return wrapper;
}

async function handleSubmit(
  form: HTMLFormElement,
  btn: HTMLButtonElement,
  feedback: HTMLElement,
): Promise<void> {
  feedback.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  const data = new FormData(form);
  const payload: CommitmentSelfSubmission = {
    firstName: (data.get('firstName') as string).trim(),
    lastName: (data.get('lastName') as string).trim(),
    position: data.get('position') as CommitmentSelfSubmission['position'],
    highSchool: (data.get('highSchool') as string).trim(),
    college: (data.get('college') as string).trim(),
    division: data.get('division') as CommitmentSelfSubmission['division'],
    status: (data.get('status') as CommitmentSelfSubmission['status']) || undefined,
  };

  try {
    const result = await submitSelfCommitment(payload);
    feedback.style.color = '#4ade80';
    feedback.textContent = `Commitment submitted for ${result.playerName ?? payload.firstName}! It will appear after verification.`;
    form.reset();
  } catch (err: unknown) {
    feedback.style.color = 'var(--error, #f87171)';
    feedback.textContent = err instanceof Error ? err.message : 'Submission failed. Please try again.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Commitment';
  }
}

// ──────────────────────────────────────────────────────
// Field helpers
// ──────────────────────────────────────────────────────

function buildField(name: string, label: string, type: string, required: boolean): HTMLElement {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem;font-size:0.88rem;color:var(--muted);';
  wrap.textContent = label;

  const input = document.createElement('input');
  input.type = type;
  input.name = name;
  input.required = required;
  input.style.cssText = `
    padding: 0.6rem 0.75rem;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg, #0b0d10);
    color: var(--fg, #e5e7eb);
    font-size: 0.95rem;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
  `;
  input.addEventListener('focus', () => {
    input.style.borderColor = '#00d4ff';
    input.style.boxShadow = '0 0 0 2px rgba(0,212,255,0.15)';
  });
  input.addEventListener('blur', () => {
    input.style.borderColor = '';
    input.style.boxShadow = '';
  });
  wrap.appendChild(input);
  return wrap;
}

function buildSelectField(
  name: string,
  label: string,
  options: readonly string[],
  required: boolean,
): HTMLElement {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem;font-size:0.88rem;color:var(--muted);';
  wrap.textContent = label;

  const select = document.createElement('select');
  select.name = name;
  select.required = required;
  select.style.cssText = `
    padding: 0.6rem 0.75rem;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg, #0b0d10);
    color: var(--fg, #e5e7eb);
    font-size: 0.95rem;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
  `;
  select.addEventListener('focus', () => {
    select.style.borderColor = '#00d4ff';
    select.style.boxShadow = '0 0 0 2px rgba(0,212,255,0.15)';
  });
  select.addEventListener('blur', () => {
    select.style.borderColor = '';
    select.style.boxShadow = '';
  });

  if (!required) {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = `-- Select --`;
    select.appendChild(empty);
  }

  for (const opt of options) {
    const el = document.createElement('option');
    el.value = opt;
    el.textContent = opt;
    select.appendChild(el);
  }
  wrap.appendChild(select);
  return wrap;
}
