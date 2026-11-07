/**
 * The landing page's study overview says what a sitting is, and calls the camera what it is
 * (audit 86 UI-13).
 *
 * "Duration: 75–120 minutes per sitting" printed the SINGLE sitting's duration (the consent's figure,
 * CONFIG.SINGLE_SITTING_DURATION) for every sitting, though a split sitting runs half the displays; and
 * the overview, the dashboard's Data Quality note, PROTOCOL's flow and the README called the tablet's
 * front camera a "webcam".
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LandingPage } from '@/start/LandingPage';
import { CONFIG } from '@/experiment/config';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; host: HTMLElement }[] = [];
afterEach(() => { for (const { root, host } of mounted.splice(0)) { act(() => root.unmount()); host.remove(); } });

function landingText(): string {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  act(() => { root.render(createElement(LandingPage, { onEnter: () => undefined })); });
  return (host.textContent ?? '').replace(/\s+/g, ' ');
}

describe('the landing page\'s study overview', () => {
  it('gives the single-sitting duration as the single sitting\'s, and says what a split runs', () => {
    const t = landingText();
    expect(t).not.toContain(`${CONFIG.SINGLE_SITTING_DURATION} per sitting`);
    expect(t).toContain(`${CONFIG.SINGLE_SITTING_DURATION} for all ${CONFIG.CONDITIONS_PER_SESSION_DEFAULT} conditions in one sitting; a split sitting runs ${CONFIG.CONDITIONS_PER_SESSION_DEFAULT / 2} of them`);
  });

  it('says front camera, not webcam', () => {
    expect(landingText()).toMatch(/tablet's front camera/);
    for (const f of ['src/start/LandingPage.tsx', 'src/dashboard/Dashboard.tsx', 'README.md']) {
      expect(readFileSync(resolve(__dirname, '..', f), 'utf8'), f).not.toMatch(/webcam/i);
    }
  });
});
