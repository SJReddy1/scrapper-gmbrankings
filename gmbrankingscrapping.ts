// gmbrankingscrapping.ts
/**
 * ULTRA-STEALTH GMB Ranking Scraper - CAPTCHA-Free Version
 * 
 * This version uses extreme stealth measures to completely avoid CAPTCHAs:
 * - Manual browser launch with real user profile
 * - Extremely slow, human-like interactions
 * - Random delays and realistic behavior patterns
 * - IP rotation and session management
 *
 * Install required packages:
 * pnpm add puppeteer-extra puppeteer-extra-plugin-stealth puppeteer @types/node
 *
 * IMPORTANT: This script is designed to be COMPLETELY UNDETECTABLE
 * Run only 1-2 keywords at a time with long breaks between sessions.
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.dev' });
dotenv.config({ path: '.env' });

import puppeteer from 'puppeteer-extra';
// @ts-ignore
import RecaptchaPlugin from 'puppeteer-extra-plugin-recaptcha';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page, LaunchOptions, ElementHandle } from 'puppeteer';
import fs from 'fs';
import path from 'path';
import getAiGeneratedText from '../services/generativeAI';
import { execFile } from 'child_process';

// Enable stealth plugin with enhanced configuration
puppeteer.use(StealthPlugin());
// Enable reCAPTCHA solver if API token is provided (2captcha or anti-captcha)
try {
  const providerId = (process.env.RECAPTCHA_PROVIDER || '').toLowerCase();
  const twoCaptcha = process.env.TWO_CAPTCHA_API_KEY;
  const antiCaptcha = process.env.ANTICAPTCHA_TOKEN;
  const token = antiCaptcha || twoCaptcha;
  const id = providerId || (antiCaptcha ? 'anticaptcha' : (twoCaptcha ? '2captcha' : ''));
  if (token && id) {
    puppeteer.use(RecaptchaPlugin({
      provider: { id: id as any, token },
      visualFeedback: false,
      solveInactiveChallenges: true,
    } as any));
    console.log(`[CAPTCHA] Using provider: ${id}`);
  }
} catch {}

console.log('[STEALTH] puppeteer-extra-plugin-stealth enabled');

// Additional stealth configurations
const STEALTH_CONFIG = {
  // Rotate these values to avoid fingerprinting
  SCREEN_RESOLUTIONS: [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
    { width: 1600, height: 900 }
  ],
  USER_AGENTS: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ],
  // For India-based usage, use Indian locales primarily with some international variety
  LANGUAGES: ['en-IN', 'en-US', 'en-GB'],
  TIMEZONES: ['Asia/Kolkata', 'Asia/Mumbai', 'Asia/Delhi', 'Asia/Bangalore']
};

// Unified CAPTCHA handling across reCAPTCHA (checkbox/image) and text captcha pages
async function tryHandleCaptcha(page: Page): Promise<boolean> {
  try {
    // If a soft-block page suggests clicking a link to proceed, click it first
    try {
      // Prepare to capture popup
      const browser = page.browser();
      const popupPromise = browser.waitForTarget(t => {
        try { return t.opener() === page.target() && /sorry|recaptcha|consent/i.test(t.url()); } catch { return false; }
      }, { timeout: 8000 }).catch(() => null as any);

      const { clicked, href } = await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[];
        const link = candidates.find(x => /click here/i.test((x.textContent || '')) || /why did this happen\?/i.test((x.textContent || '')));
        if (link) { link.click(); return { clicked: true, href: (link as HTMLAnchorElement).href || '' }; }
        return { clicked: false, href: '' };
      });

      // If a popup opened, handle captcha there
      let popupPage: Page | null = null;
      try {
        const target = await popupPromise;
        popupPage = target ? await target.page() : null;
      } catch {}

      if (!popupPage && href) {
        // Force open the same link in a new tab to surface the checkbox variant
        const forcedPromise = browser.waitForTarget(t => {
          try { return t.opener() === page.target() && /sorry|recaptcha|consent/i.test(t.url()); } catch { return false; }
        }, { timeout: 8000 }).catch(() => null as any);
        try {
          await page.evaluate((u) => { try { window.open(u, '_blank'); } catch {} }, href);
        } catch {}
        try {
          const target = await forcedPromise;
          popupPage = target ? await target.page() : null;
        } catch {}
      }

      if (popupPage) {
        try { await popupPage.bringToFront(); } catch {}
        try { await (popupPage as any).solveRecaptchas?.(); } catch {}
        // Try clicking checkbox inside popup
        try {
          const frame = popupPage.frames().find(f => /recaptcha/.test((f.url() || '').toLowerCase()));
          if (frame) {
            try { await frame.waitForSelector('#recaptcha-anchor', { timeout: 8000 }); } catch {}
            const box = await frame.$('#recaptcha-anchor');
            if (box) { await box.click({ delay: 160 + Math.floor(Math.random()*140) }); await randomDelay(1500, 2500); }
          }
        } catch {}
        // Give it a moment to validate and then close popup
        await randomDelay(800, 1400);
        try { await popupPage.close(); } catch {}
        // After popup closed, give primary page a chance to refresh state
        await randomDelay(400, 800);
      } else if (clicked) {
        // Same-tab navigation variant
        try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 }); } catch {}
      }
    } catch {}

    // Try recaptcha plugin if available
    try { await (page as any).solveRecaptchas?.(); } catch {}

    // Try to click the reCAPTCHA checkbox if it's present
    try {
      const frame = page.frames().find(f => /recaptcha/.test((f.url() || '').toLowerCase()));
      if (frame) {
        try { await frame.waitForSelector('#recaptcha-anchor', { timeout: 5000 }); } catch {}
        const box = await frame.$('#recaptcha-anchor');
        if (box) {
          await box.click({ delay: 150 + Math.floor(Math.random()*120) });
          await randomDelay(1200, 2000);
        }
      }
    } catch {}

    // Detect Google text captcha image and input
    const hasTextCaptcha = await page.evaluate(() => {
      const img = document.querySelector('img[src*="/sorry/"]') || document.querySelector('img[src*="captcha"]');
      const input = document.querySelector('input[name="captcha"]') || document.querySelector('input[type="text"][name*="captcha" i]');
      return !!(img && input);
    });
    if (hasTextCaptcha) {
      console.warn('Text CAPTCHA detected. If anti-captcha plugin is configured, it will attempt solving.');
      // If a plugin is installed that can handle image captchas, it should hook via solveRecaptchas.
      try { await (page as any).solveRecaptchas?.(); } catch {}
    }

    // If there is any submit button for captcha, try clicking it
    try {
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('input[type="submit"], button'))
          .find(b => /submit|verify|continue/i.test((b.textContent || (b as HTMLButtonElement).value || '')));
        (btn as HTMLButtonElement | HTMLInputElement)?.click?.();
      });
      await randomDelay(800, 1400);
    } catch {}

    // Heuristic: if we are no longer on a sorry/captcha page, assume we got past
    const html = (await page.content()).toLowerCase();
    const url = page.url().toLowerCase();
    if (!/\/sorry\//.test(url) && !html.includes('unusual traffic') && !html.includes('not a robot')) {
      return true;
    }
  } catch {}
  return false;
}

export interface KeywordIdea {
  keyword: string;
  query: string;
}

// Build a styled HTML report (matches required format with headers and 2 tables)
function buildStyledHtmlReport(biz: MyBizDetails, rows: RankingRow[], city: string, narrativeHtml?: string): string {
  const date = new Date();
  const auditDate = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const yesNo = (b: any) => (b ? 'Yes' : 'No');

  // Compute basic competitor stats for "Profile Authority"
  const compReviews: number[] = [];
  rows.forEach(r => {
    const d = r.competitorDetails || ({} as any);
    const n = parseInt(String(d.reviews || d.reviewCount || '0').replace(/[^0-9]/g, '')) || 0;
    if (n > 0) compReviews.push(n);
  });
  const compAvgReviews = compReviews.length ? Math.round(compReviews.reduce((a,b)=>a+b,0)/compReviews.length) : 0;
  let authority = 'Unclear';
  if (compAvgReviews >= 500) authority = 'Strong';
  else if (compAvgReviews >= 150) authority = 'Moderate';

  // Build unique competitor table (merge best-available fields)
  const compMap = new Map<string, any>();
  rows.forEach(r => {
    const d = r.competitorDetails || ({} as any);
    const key = (r.topCompetitor || 'N/A') + '|' + (d.mapsUrl || r.mapsUrl || '');
    if (!compMap.has(key)) {
      compMap.set(key, {
        name: r.topCompetitor || 'N/A',
        d: {
          ...d,
          // merge in top-level fallbacks
          rating: d.rating || r.rating,
          averageRating: d.averageRating || r.rating,
          reviews: d.reviews || r.reviews,
          website: d.website || r.website,
          hasDirections: typeof d.hasDirections === 'boolean' ? d.hasDirections : false,
          posts: d.posts || '0',
          scheduleAvailable: typeof d.scheduleAvailable === 'boolean' ? d.scheduleAvailable : (d.scheduleBtn === 'Yes'),
          callAvailable: typeof d.callAvailable === 'boolean' ? d.callAvailable : (d.callBtn === 'Yes'),
        }
      });
    }
  });
  const compRows = Array.from(compMap.values());

  const esc = (s: any) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const firstNumeric = (...vals: any[]) => {
    for (const v of vals) {
      const str = (v ?? '').toString();
      const m = str.match(/\d[\d,]*/);
      if (m) return m[0].replace(/[^0-9]/g, '');
    }
    return '';
  };
  const firstRating = (...vals: any[]) => {
    for (const v of vals) {
      const str = (v ?? '').toString();
      const m = str.match(/\d+(?:\.\d+)?/);
      if (m) return m[0];
    }
    return '';
  };

  const keywordRowsHtml = rows.map(r => `
      <tr>
        <td>${esc(r.keyword)}</td>
        <td>${esc(r.yourRanking)}</td>
        <td>${esc(r.topCompetitor)}</td>
        <td>${esc(r.theirRank)}</td>
      </tr>`).join('\n');

  const competitorRowsHtml = compRows.map(({name, d}) => {
    const reviewsNum = firstNumeric(d.reviews, d.reviewCount);
    const ratingNum = firstRating(d.rating, d.averageRating) || 'N/A';
    const scheduleYes = (d.scheduleAvailable === true) || d.scheduleBtn === 'Yes';
    const callYes = (d.callAvailable === true) || d.callBtn === 'Yes';
    const websiteYes = !!(d.website && d.website !== 'N/A');
    const dirsYes = !!d.hasDirections;
    return `
      <tr>
        <td>${esc(name)}</td>
        <td>${websiteYes ? 'Yes' : 'No'}</td>
        <td>${dirsYes ? 'Yes' : 'No'}</td>
        <td>${esc(reviewsNum)}</td>
        <td>${esc(ratingNum)}</td>
        <td>${scheduleYes ? 'Yes' : 'No'}</td>
        <td>${callYes ? 'Yes' : 'No'}</td>
      </tr>`;
  }).join('\n');

  // Styles approximating the required format
  const css = `
  @page { size: A4; margin: 15mm; }
  @media print {
    body { background: #fff !important; }
    .container { box-shadow: none !important; border: 0; margin: 0; padding: 0; width: 180mm; }
    .header { border-bottom: 1px solid #ddd; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; page-break-after: auto; }
    h1,h2 { page-break-after: avoid; }
  }
  :root{--card:#ffffff;--muted:#6b7280;--primary:#1e3a8a;--accent:#2563eb;--border:#e5e7eb;--bg:#f8fafc}
  *{box-sizing:border-box}body{font-family:Inter,system-ui,Arial,Helvetica,sans-serif;background:var(--bg);color:#0f172a;margin:0;padding:24px}
  .container{max-width:980px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.06);padding:24px}
  .header{display:flex;align-items:center;justify-content:space-between;padding:8px 4px 20px;border-bottom:1px solid var(--border)}
  .title{display:flex;align-items:center;gap:12px}
  .title h1{margin:0;font-size:26px;color:var(--primary);letter-spacing:.4px}
  .meta{font-size:13px;color:var(--muted)}
  .snapshot{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:18px 0 8px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px}
  .card h4{margin:0 0 8px;color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.6px}
  .card .value{font-size:20px;font-weight:700}
  h2.section{margin:22px 0 12px;font-size:18px;color:#0f172a;display:flex;align-items:center;gap:8px}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:12px;overflow:hidden}
  th,td{padding:10px 12px;border-bottom:1px solid var(--border);font-size:14px}
  th{background:#f1f5f9;text-align:left;color:#0f172a}
  tr:last-child td{border-bottom:none}
  .grid-2{display:grid;grid-template-columns:1fr;gap:18px}
  @media(min-width:900px){.grid-2{grid-template-columns:1fr}}
  .note{font-size:12px;color:var(--muted)}
  `;

  return `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>GMB Audit Report — ${esc(biz.name)}</title>
    <style>${css}</style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <div class="title">
          <img alt="Google My Business" src="https://www.gstatic.com/images/icons/material/system_gm/1x/store_mall_directory_gm_blue_24dp.png" width="28"/>
          <h1>GMB AUDIT REPORT</h1>
        </div>
        <div class="meta">
          <div><strong>Profile:</strong> ${esc(biz.name)} — ${esc(biz.category || 'Business')}</div>
          <div><strong>Location:</strong> ${esc(city || '-')}</div>
          <div><strong>Audit Date:</strong> ${esc(auditDate)}</div>
        </div>
      </div>

      <h2 class="section">Snapshot</h2>
      <div class="snapshot">
        <div class="card"><h4>Reviews</h4><div class="value">${esc(biz.reviewCount || 'NA')} ${biz.averageRating && biz.averageRating !== 'N/A' ? `(Avg — ${esc(biz.averageRating)})` : ''}</div></div>
        <div class="card"><h4>Website</h4><div class="value">${biz.website ? 'Yes' : 'No'}</div></div>
        <div class="card"><h4>Directions / Call</h4><div class="value">${yesNo(biz.hasDirections)} / ${yesNo(biz.callAvailable)}</div></div>
        <div class="card"><h4>“Schedule Now” on GMB</h4><div class="value">${yesNo(biz.scheduleAvailable)}</div></div>
        <div class="card"><h4>Profile Authority</h4><div class="value">${authority}</div><div class="note">Top competitors avg ${compAvgReviews.toLocaleString()} reviews</div></div>
      </div>

      <h2 class="section">Current Keyword Rankings</h2>
      <table>
        <thead><tr><th>Keyword</th><th>Your Ranking</th><th>Top Competitor</th><th>Their Rank</th></tr></thead>
        <tbody>
          ${keywordRowsHtml}
        </tbody>
      </table>

      <h2 class="section">Competitor Benchmarking — ${esc(city || 'Market')}</h2>
      <table>
        <thead><tr>
          <th>Profile</th><th>Website</th><th>Directions</th><th>Total Reviews</th><th>Avg. Rating</th><th>Schedule Now</th><th>Call</th>
        </tr></thead>
        <tbody>
          ${competitorRowsHtml}
        </tbody>
      </table>
      ${narrativeHtml ? `
      <h2 class="section">Key Insights & Recommendations</h2>
      <div class="card"><div class="value" style="font-weight:500;font-size:14px;line-height:1.6">${narrativeHtml}</div></div>
      ` : ''}
    </div>
  </body>
  </html>`;
}

// -------------------- Report Generation --------------------

function buildKeywordCompetitorBlock(rows: RankingRow[]): string {
  const header = ['Keyword','My Rank','Competitor','Competitor Rank','Comp. Reviews','Comp. Avg Rating','Comp. Website','Comp. Call','Comp. Schedule','Comp. Description'];
  const lines = [header.join(' | '), header.map(()=>'---').join(' | ')];
  for (const r of rows) {
    const d = r.competitorDetails || ({} as any);
    const compDesc = d.description || d.about || '';
    lines.push([
      r.keyword,
      r.yourRanking,
      r.topCompetitor,
      r.theirRank,
      d.reviews || 'N/A',
      d.averageRating || d.rating || 'N/A',
      d.website || 'N/A',
      d.callAvailable ? 'Yes' : (d.callBtn ? 'Yes' : 'No'),
      d.scheduleAvailable ? 'Yes' : (d.scheduleBtn ? 'Yes' : 'No'),
      compDesc.replace(/\n+/g,' ').slice(0,180)
    ].join(' | '));
  }
  return lines.join('\n');
}

function buildGmbReportPrompt(biz: MyBizDetails, rows: RankingRow[]): string {
  const keywordTable = buildKeywordCompetitorBlock(rows);
  const template = `You are a GMB (Google My Business) report analyst.  
Using the provided GMB profile data and competitor keyword analysis, generate a detailed GMB report in the format of “Sreesurya Ayurveda.html” (HTML structure with headings, tables, and descriptive sections).  

### Base Profile Data
Profile Title: {{profile_title}}  
Description: {{profile_description}}  
Number of GMB Posts: {{num_posts}}  
Total Reviews: {{total_reviews}}  
Website: {{website_status}}  
Directions: {{directions_status}}  
Call Button: {{call_button_status}}  
Schedule Now Button: {{schedule_button_status}}  
Average Rating: {{avg_rating}}  

### Keyword & Competitor Data
For each keyword below, provide:  
- Current Ranking of Base Profile  
- Top Competitor (Name, Website, Description)  
- Competitor Ranking  
- Competitor Reviews, Avg Rating, Content Count, Buttons (Call/Schedule)  
- Gap Analysis vs Base Profile  

{{keyword_competitor_table}}

### Output Format
- Write the report in **descriptive HTML format**.  
- Include sections:  
  - Profile Overview  
  - Keyword Performance & Competitor Analysis (tables + descriptive narrative)  
  - Key Insights & Recommendations (SEO, reviews, USP positioning, website fixes, etc.)  
  - Final Summary of Growth Potential.  

Make it professional, analytical, and visually structured for a client-facing report.`;

  const descParts = [biz.category, biz.address].filter(Boolean).join(' | ');
  return template
    .replace('{{profile_title}}', biz.name || 'N/A')
    .replace('{{profile_description}}', descParts || 'N/A')
    .replace('{{num_posts}}', biz.posts || '0')
    .replace('{{total_reviews}}', biz.reviewCount || '0')
    .replace('{{website_status}}', biz.website ? 'Yes' : 'No')
    .replace('{{directions_status}}', biz.hasDirections ? 'Yes' : 'No')
    .replace('{{call_button_status}}', biz.callAvailable ? 'Yes' : 'No')
    .replace('{{schedule_button_status}}', biz.scheduleAvailable ? 'Yes' : 'No')
    .replace('{{avg_rating}}', biz.averageRating || 'N/A')
    .replace('{{keyword_competitor_table}}', keywordTable);
}

// Build a short narrative prompt for AI to return only HTML paragraphs and bullet lists (no full HTML shell)
function buildNarrativePrompt(biz: MyBizDetails, rows: RankingRow[], city: string): string {
  const summary = {
    name: biz.name,
    city,
    posts: biz.posts,
    reviews: biz.reviewCount,
    avgRating: biz.averageRating,
    website: !!biz.website,
    directions: !!biz.hasDirections,
    call: !!biz.callAvailable,
    schedule: !!biz.scheduleAvailable,
  };
  const compactRows = rows.map(r => ({
    keyword: r.keyword,
    yourRank: r.yourRanking,
    competitor: r.topCompetitor,
    compRank: r.theirRank,
    compReviews: (r.competitorDetails?.reviews || r.reviews || ''),
    compRating: (r.competitorDetails?.rating || r.rating || ''),
  }));
  return `You are a GMB analyst. Using the JSON below, write a concise, client-facing narrative in HTML fragment form (no <html> or <body>). Include:
  - Profile overview in 2-3 short paragraphs.
  - Key findings from keyword rankings and competitor benchmarking.
  - 6-10 specific recommendations (bulleted) covering SEO, reviews, content, website fixes, GMB buttons, and positioning.
  Keep it professional and clear.

  Base Profile Summary JSON: ${JSON.stringify(summary)}
  Keyword Rows JSON: ${JSON.stringify(compactRows)}
`;
}

async function saveHtmlAndMaybePdf(html: string, profileTitle: string, wantPdf: boolean) {
  const reportsDir = path.resolve(process.cwd(), 'reports');
  const pdfDir = path.join(reportsDir, 'pdf');
  try { fs.mkdirSync(reportsDir, { recursive: true }); } catch {}
  if (wantPdf) { try { fs.mkdirSync(pdfDir, { recursive: true }); } catch {} }

  const safe = (profileTitle || 'Profile').replace(/[^a-z0-9-_]+/gi, '_').slice(0, 80);
  const htmlPath = path.join(reportsDir, `GMB_Report_${safe}.html`);
  fs.writeFileSync(htmlPath, html, 'utf-8');
  console.log(`\nSaved HTML report: ${htmlPath}`);

  if (!wantPdf) return;
  const pdfPath = path.join(pdfDir, `GMB_Report_${safe}.pdf`);

  const tryExec = (bin: string, args: string[]) => new Promise<void>((resolve, reject) => {
    execFile(bin, args, (err) => err ? reject(err) : resolve());
  });

  try {
    await tryExec('wkhtmltopdf', [htmlPath, pdfPath]);
    console.log(`Saved PDF report (wkhtmltopdf): ${pdfPath}`);
  } catch {
    try {
      await tryExec('weasyprint', [htmlPath, pdfPath]);
      console.log(`Saved PDF report (weasyprint): ${pdfPath}`);
    } catch (e) {
      console.warn('Failed to render PDF via wkhtmltopdf/weasyprint. HTML saved. Install one of these to enable PDF export.');
    }
  }
}

// Fetch my business details by searching Google (RHS panel), not opening Maps directly
type MyBizDetails = {
  name: string;
  averageRating: string;
  reviewCount: string;
  category: string;
  address: string;
  phone: string;
  website: string;
  websiteBtn: string;
  scheduleAvailable: boolean;
  callAvailable: boolean;
  hasDirections: boolean;
  posts: string;
};

async function fetchMyBusinessDetailsFromGoogle(business: string, city: string, mapsUrl?: string): Promise<MyBizDetails | null> {
  const query = `${business} ${city}`.trim();
  const userDataDir = process.env.USER_DATA_DIR || path.resolve(process.cwd(), '.puppeteer_profile');
  try { fs.mkdirSync(userDataDir, { recursive: true }); } catch {}

  // --- Unified Launch Options using STEALTH_CONFIG and full emulation ---
const randRes = STEALTH_CONFIG.SCREEN_RESOLUTIONS[Math.floor(Math.random() * STEALTH_CONFIG.SCREEN_RESOLUTIONS.length)];
const randUA = STEALTH_CONFIG.USER_AGENTS[Math.floor(Math.random() * STEALTH_CONFIG.USER_AGENTS.length)];
const randLang = STEALTH_CONFIG.LANGUAGES[Math.floor(Math.random() * STEALTH_CONFIG.LANGUAGES.length)];
const randTZ = STEALTH_CONFIG.TIMEZONES[Math.floor(Math.random() * STEALTH_CONFIG.TIMEZONES.length)];
const launchOptions: LaunchOptions & { ignoreHTTPSErrors?: boolean; userDataDir?: string } = {
  headless: process.env.HEADLESS === 'true' ? ('new' as any) : false,
  ignoreHTTPSErrors: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    `--window-size=${randRes.width},${randRes.height}`,
    `--lang=${randLang}`,
    `--disable-blink-features=AutomationControlled`,
    `--timezone=${randTZ}`,
  ],
  defaultViewport: {
    width: randRes.width + Math.floor(Math.random() * 60),
    height: randRes.height + Math.floor(Math.random() * 60),
    deviceScaleFactor: 1,
    hasTouch: false,
    isLandscape: false,
  },
  userDataDir,
};
// --- End Launch Options ---


  const browser = await puppeteer.launch(launchOptions) as Browser;
  const [page] = await browser.pages();

  // --- Emulate timezone, language, geolocation ---
  try { await page.emulateTimezone(randTZ); } catch {}
  try { await page.setExtraHTTPHeaders({
    'Accept-Language': `${randLang},en;q=0.9`
  }); } catch {}
  try { await page.setGeolocation({ latitude: 19.0760, longitude: 72.8777, accuracy: 100 }); } catch {} // Mumbai default, override as needed
  try { await page.setUserAgent(randUA); } catch {}

  // --- Advanced fingerprinting fixes (WebGL, canvas, etc.) ---
  await page.evaluateOnNewDocument(() => {
    // WebGL vendor spoof
    try {
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) { return 'Intel Inc.'; }
        if (parameter === 37446) { return 'Intel Iris OpenGL Engine'; }
        return getParameter.call(this, parameter);
      };
    } catch {}
    // Canvas spoof
    try {
      const toDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(...args) {
        return toDataURL.apply(this, args).replace('A', 'B');
      };
    } catch {}
  });

  // If a Maps URL is provided, go directly to it and scrape the LHS panel instead of doing a Google search
  if (mapsUrl && mapsUrl.includes('google.com/maps')) {
    try {
      const visited = await safeGoto(page, mapsUrl, { timeout: 60000 });
      if (!visited) throw new Error('Failed to open Maps URL');
      try { await (page as any).solveRecaptchas?.(); } catch {}
      const maps = await scrapeMapsPlace(page, mapsUrl);
      const cleanVal = (s: any) => String(s || '').trim() || 'N/A';
      console.log('\nMy Business Details (from Google Maps LHS)');
      console.log(`- Name: ${cleanVal(maps.name || business)}`);
      console.log(`- Rating: ${cleanVal(maps.averageRating || maps.rating)}`);
      console.log(`- Reviews: ${cleanVal(maps.reviewCount || maps.reviews)}`);
      console.log(`- Category: ${cleanVal(maps.category)}`);
      console.log(`- Address: ${cleanVal(maps.address)}`);
      console.log(`- Phone: ${cleanVal(maps.phone)}`);
      console.log(`- Website: ${maps.website && maps.website !== 'N/A' ? 'Yes' : 'No'}`);
      console.log(`- Website URL: ${cleanVal(maps.website)}`);
      console.log(`- Schedule: ${maps.scheduleAvailable ? 'Yes' : 'No'}`);
      console.log(`- Call: ${maps.callAvailable ? 'Yes' : 'No'}`);
      console.log(`- Directions: ${maps.hasDirections ? 'Yes' : 'No'}`);
      console.log(`- Posts: ${cleanVal(maps.posts || '0')}`);
      try { await browser.close(); } catch {}
      return {
        name: cleanVal(maps.name || business),
        averageRating: cleanVal(maps.averageRating || maps.rating),
        reviewCount: cleanVal(maps.reviewCount || maps.reviews),
        category: cleanVal(maps.category),
        address: cleanVal(maps.address),
        phone: cleanVal(maps.phone),
        website: cleanVal(maps.website),
        websiteBtn: maps.website && maps.website !== 'N/A' ? 'Yes' : 'No',
        scheduleAvailable: !!maps.scheduleAvailable,
        callAvailable: !!maps.callAvailable,
        hasDirections: !!maps.hasDirections,
        posts: cleanVal(maps.posts || '0'),
      } as MyBizDetails;
    } catch (e) {
      console.warn('Failed to fetch details via Maps LHS, falling back to Google search:', (e as Error).message);
      // Fall through to legacy search-based flow below
    }
  }

  // --- Browsing warm-up before business search ---
  // Visit a few unrelated Google pages and do some generic searches
  const warmupQueries = ['weather today', 'news India', 'cricket score', 'how to make chai'];
  for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
    try {
      const q = warmupQueries[Math.floor(Math.random() * warmupQueries.length)];
      await safeGoto(page, 'https://www.google.com/');
      await acceptGoogleConsent(page);
      let sel = await findSearchBoxSelector(page);
      if (sel) {
        await typeLikeHuman(page, sel, q);
        await page.keyboard.press('Enter');
        await intelligentDelay('search');
        await simulateReadingBehavior(page);
      }
    } catch {}
  }

  // --- Manual login step (optional, only needed once per persistent profile) ---
  // If you want to log in to a Google account, do it here and then exit. The session will persist in userDataDir.
  // Uncomment to pause for manual login:
  // console.log('If you want to log in, do so now. Press Enter to continue...');
  // require('readline').createInterface({ input: process.stdin, output: process.stdout }).question('Press Enter to continue...', () => {});

  try {
    const ok = await performHumanSearch(page, query);
    // Solve any visible CAPTCHAs after navigation
    await page.solveRecaptchas();
    if (!ok) throw new Error('Google search navigation failed');
    // local short delay (do not depend on randomDelay which is declared later)
    await new Promise(r => setTimeout(r, 1000 + Math.floor(Math.random() * 700)));

    // Wait a bit for RHS action buttons (Website/Directions/Reviews) to render
    try {
      // If CAPTCHA is present, allow the user time to solve it manually
      const hasCaptcha = await page.$('iframe[src*="recaptcha"], iframe[src*="captcha"], #captcha, .g-recaptcha');
      if (hasCaptcha) {
        console.warn('\nCAPTCHA detected on Google search. Please complete the verification in the browser window.');
        console.warn('The scraper will wait up to 180s for verification to complete...');
        try { await page.bringToFront(); } catch {}
        try {
          await page.waitForFunction(() => {
            const cap = document.querySelector('iframe[src*="recaptcha"], iframe[src*="captcha"], #captcha, .g-recaptcha');
            const rhs = document.querySelector('#rhs');
            return !cap && !!rhs;
          }, { timeout: 180000 });
        } catch {}
      }
      await page.waitForFunction(() => {
        const scope: Document | Element = document;
        const cand = Array.from(scope.querySelectorAll('#rhs a, #rhs button, #rhs [role="link"], a, button, [role="link"]')) as HTMLElement[];
        const anyAction = cand.some(el => {
          const t = (el.getAttribute('aria-label') || el.textContent || '').toLowerCase();
          const href = ((el as HTMLAnchorElement).href || '').toLowerCase();
          const attrid = (el.getAttribute('data-attrid') || '').toLowerCase();
          return t.includes('website') || t.includes('directions') || href.includes('/maps/dir/') || attrid.includes('direction');
        });
        const dirSpan = Array.from(scope.querySelectorAll('#rhs .PbOY2e, .PbOY2e')).some(el => (/\bdirections\b/i.test(el.textContent || '')));
        return anyAction || dirSpan;
      }, { timeout: 5000 });
    } catch {}

    // Extract RHS knowledge panel with robust fallbacks (subset of scrapeGoogleSearch RHS logic)
    const rhs = await page.evaluate(() => {
      const get = (sel: string) => (document.querySelector(sel) as HTMLElement | null);
      const getAll = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
      const text = (el: Element | null) => (el?.textContent || '').trim();
      const attr = (el: Element | null, a: string) => (el && (el as HTMLElement).getAttribute?.(a)) || '';

      // try standard RHS container selectors
      const rhsRoot = get('#rhs') || get('[data-attrid="title"]')?.closest('#rhs') as HTMLElement || (get('#rhs') as HTMLElement);
      const root = rhsRoot || document;

      const out: any = {};
      // Name
      out.name = text(root.querySelector('#rhs h2') || root.querySelector('#rhs h3') || root.querySelector('[data-attrid="title"]') || root.querySelector('h2[data-attrid]'));
      if (!out.name) {
        const cand = root.querySelector('#rhs .SPZz6b, #rhs .qrShPb, #rhs [role="heading"]');
        out.name = text(cand);
      }
      // Rating & reviews
      const ratingEl = root.querySelector('[aria-label*="stars" i], [aria-label*="rating" i], .Aq14fc') as HTMLElement | null;
      out.averageRating = text(ratingEl).replace(/[^0-9.]/g, '') || text(ratingEl);
      // Prefer link that says "Google reviews"; fallback to any reviews link and extract digits
      const reviewCandidates = Array.from(root.querySelectorAll('#rhs a, #rhs span, a, span')) as HTMLElement[];
      const reviewNode = reviewCandidates.find(el => /google\s+reviews/i.test(el.textContent || ''))
        || reviewCandidates.find(el => /reviews?/i.test(el.textContent || ''));
      out.reviewCount = reviewNode ? (reviewNode.textContent || '').replace(/[^0-9,]/g, '') : '';
      // Category
      out.category = text(root.querySelector('[data-attrid="subtitle"]'));
      // Address / Phone
      out.address = text(root.querySelector('[data-attrid*="address" i], [data-attrid="kc:/location/location:address"]'));
      const phoneEl = root.querySelector('a[href^="tel:"], span[aria-label*="Phone"], [data-attrid*="phone"]') as HTMLElement | null;
      out.phone = (attr(phoneEl, 'href') || '').replace(/^tel:/, '') || text(phoneEl);
      // Website button (robust: look for visible link/button with text)
      const actionNodes = Array.from(root.querySelectorAll('#rhs a, #rhs button, #rhs [role="link"], a, button, [role="link"]')) as HTMLElement[];
      const siteEl = actionNodes.find(el => /website/i.test((el.getAttribute('aria-label') || el.textContent || '')));
      const siteHref = (siteEl as HTMLAnchorElement)?.href || '';
      out.website = siteHref;
      out.websiteBtn = siteEl ? 'Yes' : 'No';
      // Directions button (robust)
      let dirEl = actionNodes.find(el => {
        const label = (el.getAttribute('aria-label') || el.textContent || '').toLowerCase();
        const href = ((el as HTMLAnchorElement).href || '').toLowerCase();
        const attrid = (el.getAttribute('data-attrid') || '').toLowerCase();
        // Accept variants: Directions, Get directions, data-attrid contains direction, direct maps dir links
        return label.includes('direction') || href.includes('/maps/dir/') || attrid.includes('direction');
      })
      || root.querySelector('a[aria-label*="Direction" i], [data-attrid*="direction" i]')
      || Array.from(root.querySelectorAll('#rhs a, #rhs button, #rhs [role="link"], a, button, [role="link"]')).find((el: any) => (el.innerText || '').trim().toLowerCase() === 'directions');
      if (!dirEl) {
        // Look for the span label used by Google buttons, then bubble up to clickable container
        const span = root.querySelector('span.PbOY2e');
        if (span && /\bdirections\b/i.test(span.textContent || '')) {
          const action = (span.closest('[role="link"]') as HTMLElement) || (span.parentElement as HTMLElement);
          if (action) dirEl = action as any;
        }
      }
      if (!dirEl) {
        // Match Google's local action container variant
        const localActions = Array.from(root.querySelectorAll('div.bkaPDb[jsname="UXbvIb"], [ssk*="local_action"], [jsname="UXbvIb"]')) as HTMLElement[];
        for (const la of localActions) {
          const lbl = (la.querySelector('.PbOY2e') as HTMLElement | null)?.textContent || '';
          if (/\bdirections\b/i.test(lbl)) { dirEl = la; break; }
        }
      }
      out.hasDirections = !!dirEl;
      // Schedule button (appointment/book/reserve)
      let schedEl = root.querySelector('a[aria-label*="Schedule" i], a[data-attrid*="appointment" i], a[aria-label*="Book" i], a[data-attrid*="reserve" i], a[data-attrid*="booking" i]') as HTMLElement | null;
      if (!schedEl) {
        const sSpan = Array.from(root.querySelectorAll('span.PbOY2e')).find(sp => /\bbook\b|\bbook online\b|\bappointment\b|\breserve\b|\bbooking\b/i.test(sp.textContent || '')) as HTMLElement | undefined;
        if (sSpan) {
          schedEl = (sSpan.closest('[role="link"], a, button') as HTMLElement) || null;
        }
      }
      out.scheduleAvailable = !!schedEl;
      out.scheduleBtn = out.scheduleAvailable ? 'Yes' : 'No';
      // Call button
      const callEl = root.querySelector('a[href^="tel:"], a[aria-label^="Call" i], button[aria-label^="Call" i]') as HTMLElement | null;
      out.callAvailable = !!callEl; out.callBtn = out.callAvailable ? 'Yes' : 'No';
      // Posts (heuristic)
      const posts = getAll('#rhs a[href*="posts"], #rhs a[href*="/posts"], #rhs [data-attrid*="posts"]');
      out.posts = String(posts.length || 0);
      return out;
    });

    // Clean common prefixes Google may include in text
    const clean = (s: any) => String(s || '').replace(/^\s*(Address:|Phone:|Website:)\s*/i, '').trim() || 'N/A';
    console.log('\nMy Business Details (from Google RHS)');
    console.log(`- Name: ${clean(rhs?.name || business)}`);
    console.log(`- Rating: ${clean(rhs?.averageRating)}`);
    console.log(`- Reviews: ${clean(rhs?.reviewCount)}`);
    console.log(`- Category: ${clean(rhs?.category)}`);
    console.log(`- Address: ${clean(rhs?.address)}`);
    console.log(`- Phone: ${clean(rhs?.phone)}`);
    // Show presence + URL separately for clarity
    console.log(`- Website: ${(rhs?.website ? 'Yes' : 'No')}`);
    console.log(`- Website URL: ${clean(rhs?.website)}`);
    console.log(`- Schedule: ${(rhs?.scheduleAvailable ? 'Yes' : 'No')}`);
    console.log(`- Call: ${(rhs?.callAvailable ? 'Yes' : 'No')}`);
    console.log(`- Directions: ${(rhs?.hasDirections ? 'Yes' : 'No')}`);
    console.log(`- Posts: ${clean(rhs?.posts || '0')}`);
    try { await browser.close(); } catch {}
    return {
      name: clean(rhs?.name || business),
      averageRating: clean(rhs?.averageRating),
      reviewCount: clean(rhs?.reviewCount),
      category: clean(rhs?.category),
      address: clean(rhs?.address),
      phone: clean(rhs?.phone),
      website: clean(rhs?.website),
      websiteBtn: rhs?.website ? 'Yes' : 'No',
      scheduleAvailable: !!rhs?.scheduleAvailable,
      callAvailable: !!rhs?.callAvailable,
      hasDirections: !!rhs?.hasDirections,
      posts: clean(rhs?.posts || '0'),
    } as MyBizDetails;
  } catch (e) {
    console.warn('Failed to fetch my business details from Google:', (e as Error).message);
    try { await browser.close(); } catch {}
    return null;
  } finally {
    try { await page.close(); } catch {}
    try { await browser.close(); } catch {}
  }
}

let __hasWarmedUp = false;

// Enhanced human-like typing with more realistic patterns
async function typeLikeHuman(page: Page, selector: string, text: string) {
  // Longer idle before interacting to simulate thinking
  await randomDelay(500, 1200);
  
  // Prefer clicking the box like a user with more realistic movement
  const el = await page.$(selector);
  if (el) {
    try {
      const box = await el.boundingBox();
      if (box) {
        // More natural mouse movement with curves
        const startX = Math.random() * 200 + 100;
        const startY = Math.random() * 200 + 100;
        const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
        const targetY = box.y + box.height * (0.4 + Math.random() * 0.2);
        
        // Move in a slight curve
        const midX = (startX + targetX) / 2 + (Math.random() - 0.5) * 50;
        const midY = (startY + targetY) / 2 + (Math.random() - 0.5) * 30;
        
        await page.mouse.move(startX, startY);
        await page.mouse.move(midX, midY, { steps: 5 + Math.floor(Math.random() * 5) });
        await page.mouse.move(targetX, targetY, { steps: 8 + Math.floor(Math.random() * 7) });
        
        await randomDelay(200, 500);
        await page.mouse.click(targetX, targetY, { delay: 80 + Math.floor(Math.random() * 120) });
      }
    } catch {}
  }
  
  // Fallback focus with delay
  try { 
    await page.focus(selector); 
    await randomDelay(100, 300);
  } catch {}
  
  // Clear any existing text first
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await randomDelay(50, 150);
  
  // Much slower, more realistic human typing patterns
  const words = text.split(' ');
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    
    // Type each character with much slower, more human delays
    for (const ch of word.split('')) {
      const baseDelay = 300 + Math.floor(Math.random() * 400); // Much slower: 300-700ms
      // Even slower for certain characters that are harder to type
      const charDelay = /[A-Z0-9!@#$%^&*()]/.test(ch) ? baseDelay * 2 : baseDelay;
      
      await page.type(selector, ch, { delay: charDelay });
      
      // More frequent longer pauses (like thinking or looking at keyboard)
      if (Math.random() < 0.25) { // Increased from 0.15 to 0.25
        await randomDelay(800, 2000); // Longer pauses: 800ms-2s
      }
    }
    
    // Add space between words (except for last word)
    if (i < words.length - 1) {
      await page.type(selector, ' ', { delay: 200 + Math.floor(Math.random() * 300) });
      // Much longer pause between words
      if (Math.random() < 0.5) { // Increased from 0.3 to 0.5
        await randomDelay(500, 1500); // Longer word pauses
      }
    }
  }
  
  // Much longer pause after typing (like reviewing what was typed)
  await randomDelay(1000, 3000); // 1-3 seconds to review
}

// Accept Google's consent dialog if present (top-level and inside consent iframes)
async function acceptGoogleConsent(page: Page) {
  const tryClick = async (ctx: Page | import('puppeteer').Frame) => {
    const selectors = [
      'button:has-text("I agree")',
      'button:has-text("Accept all")',
      'button:has-text("Accept")',
      '#L2AGLb',
      '[aria-label*="Accept" i]'
    ];
    for (const sel of selectors) {
      try {
        const btn = await (ctx as any).$(sel);
        if (btn) {
          if ('mouse' in ctx) {
            await humanMoveMouse(ctx as Page, sel);
          }
          await btn.click();
          await new Promise(r => setTimeout(r, 800 + Math.floor(Math.random() * 1200)));
          return true;
        }
      } catch {}
    }
    return false;
  };

  // 1) Try in main page
  if (await tryClick(page)) return;

  // 2) Try in consent frames
  for (const f of page.frames()) {
    const url = f.url() || '';
    if (url.includes('consent.') || url.includes('consent.google') || url.includes('privacy')) {
      if (await tryClick(f)) return;
    }
  }
}

// Find the Google search box selector across variants
async function findSearchBoxSelector(page: Page): Promise<string | null> {
  const candidates = [
    'input[name="q"]',
    'textarea[name="q"]',
    'input#APjFqb',
    'input.gLFyf',
    'textarea.gLFyf',
    'input[aria-label="Search"]',
    'textarea[aria-label="Search"]'
  ];
  // Wait briefly for any candidate to appear
  try {
    await page.waitForFunction((sels: string[]) => sels.some(s => !!document.querySelector(s)), { timeout: 8000 }, candidates);
  } catch {}
  for (const sel of candidates) {
    const exists = await page.$(sel);
    if (exists) return sel;
  }
  return null;
}

// Enhanced human search behavior with more realistic patterns
async function performHumanSearch(page: Page, query: string): Promise<boolean> {
  // Start with Google homepage (India variant helps bypass some soft-blocks)
  const ok = await safeGoto(page, 'https://www.google.co.in/?hl=en-IN&gl=IN&pws=0');
  if (!ok) return false;
  await acceptGoogleConsent(page);

  // Minimal warm-up to avoid triggering CAPTCHA
  if (!__hasWarmedUp) {
    try {
      // Skip heavy warm-up to reduce startup delay
      // Optionally perform a tiny idle to stabilize
      await randomDelay(100, 250);
    } catch (e) {
      console.warn('Session initialization failed, continuing with search:', e);
    }
    __hasWarmedUp = true;
  }
  
  // Find search box with multiple attempts
  let sel = await findSearchBoxSelector(page);
  let attempts = 0;
  while (!sel && attempts < 3) {
    attempts++;
    console.log(`Search box not found, attempt ${attempts}/3`);
    
    // Try different Google URLs
    const fallbackUrls = [
      'https://www.google.co.in/webhp?hl=en-IN&gl=IN&pws=0',
      'https://www.google.co.in/search?hl=en-IN&gl=IN&pws=0',
      'https://www.google.com/webhp?hl=en&source=hp'
    ];
    
    await safeGoto(page, fallbackUrls[attempts - 1]);
    await acceptGoogleConsent(page);
    await randomDelay(1000, 2000);
    sel = await findSearchBoxSelector(page);
  }
  
  if (!sel) {
    console.error('Could not find search box after multiple attempts');
    return false;
  }
  
  // Simulate human behavior before typing
  await randomDelay(800, 1500);
  
  // Sometimes click elsewhere first (like humans do)
  if (Math.random() > 0.7) {
    try {
      const viewport = page.viewport();
      if (viewport) {
        await page.mouse.click(
          Math.random() * viewport.width * 0.8 + viewport.width * 0.1,
          Math.random() * viewport.height * 0.3 + viewport.height * 0.1
        );
        await intelligentDelay('click');
      }
    } catch {}
  }
  
  // Type the search query
  await typeLikeHuman(page, sel, query);
  
  // Human-like pause before submitting (reading what was typed)
  await intelligentDelay('typing');
  
  // Sometimes use Enter, sometimes click search button
  if (Math.random() > 0.3) {
    await page.keyboard.press('Enter');
  } else {
    try {
      const searchBtn = await page.$('input[name="btnK"], button[aria-label="Google Search"]');
      if (searchBtn) {
        await searchBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }
    } catch {
      await page.keyboard.press('Enter');
    }
  }
  
  // Wait for navigation with longer timeout
  try {
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
  } catch {
    // Fallback wait
    await randomDelay(3000, 5000);
  }
  
  // Simulate reading search results
  await simulateReadingBehavior(page);
  
  return true;
}

// Simulate realistic reading behavior on search results
async function simulateReadingBehavior(page: Page): Promise<void> {
  try {
    // Scroll down slowly like reading results
    const scrollSteps = Math.floor(Math.random() * 4) + 2;
    for (let i = 0; i < scrollSteps; i++) {
      const scrollAmount = Math.floor(Math.random() * 200) + 150;
      await page.evaluate((amount) => {
        window.scrollBy(0, amount);
      }, scrollAmount);
      
      // Pause like reading each result
      await randomDelay(1000, 3000);
      
      // Occasionally hover over results
      if (Math.random() > 0.6) {
        try {
          const results = await page.$$('.g h3, .LC20lb, .yuRUbf h3');
          if (results.length > 0) {
            const randomResult = results[Math.floor(Math.random() * Math.min(results.length, 3))];
            await randomResult.hover();
            await intelligentDelay('scroll'); // Use intelligentDelay for hover timing
          }
        } catch {}
      }
    }
    
    // Sometimes scroll back up
    if (Math.random() > 0.7) {
      await page.evaluate(() => window.scrollBy(0, -200));
      await randomDelay(500, 1000);
    }
  } catch (error) {
    // Ignore errors in reading simulation
  }
}

// Briefly explore the page like a human (mouse move + small scrolls)
async function explorePageHuman(page: Page) {
  try {
    // Random small scrolls
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => window.scrollBy(0, Math.floor(Math.random() * 350) + 120));
      await new Promise(r => setTimeout(r, 300 + Math.floor(Math.random() * 600)));
    }
    // Small mouse wiggle
    const vw = await page.viewport();
    const x = 100 + Math.floor(Math.random() * Math.max(200, (vw?.width || 800) / 3));
    const y = 200 + Math.floor(Math.random() * Math.max(200, (vw?.height || 600) / 3));
    await page.mouse.move(x, y, { steps: 12 });
    await new Promise(r => setTimeout(r, 400 + Math.floor(Math.random() * 700)));
  } catch {}
}

// Enhanced CAPTCHA mitigation with intelligent backoff
async function mitigateCaptcha(page: Page, targetUrl: string, attempts = 3): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const captcha = await page.$('iframe[src*="recaptcha"], iframe[src*="captcha"], #captcha, .g-recaptcha, .captcha');
    if (!captcha) return; // no captcha, proceed

    // Progressive backoff - longer delays for subsequent attempts
    const baseDelay = 20000 + (i * 15000); // 20s, 35s, 50s
    const delay = baseDelay + Math.floor(Math.random() * 20000);
    
    console.warn(`CAPTCHA detected (attempt ${i + 1}/${attempts}). Implementing ${Math.round(delay/1000)}s backoff strategy...`);
    
    // Simulate human behavior during wait
    const waitSteps = Math.floor(delay / 5000); // Break wait into 5s chunks
    for (let step = 0; step < waitSteps; step++) {
      await new Promise(r => setTimeout(r, 5000));
      
      // Perform human-like actions during wait
      try {
        if (Math.random() > 0.5) {
          // Random scroll
          await page.evaluate(() => {
            const scrollAmount = Math.floor(Math.random() * 300) + 100;
            window.scrollBy(0, Math.random() > 0.5 ? scrollAmount : -scrollAmount);
          });
        }
        
        if (Math.random() > 0.7) {
          // Random mouse movement
          const viewport = page.viewport();
          if (viewport) {
            await page.mouse.move(
              Math.random() * viewport.width,
              Math.random() * viewport.height,
              { steps: Math.floor(Math.random() * 10) + 5 }
            );
          }
        }
        
        // Check if CAPTCHA is gone
        const stillHasCaptcha = await page.$('iframe[src*="recaptcha"], iframe[src*="captcha"], #captcha, .g-recaptcha, .captcha');
        if (!stillHasCaptcha) {
          console.log('CAPTCHA resolved during wait period');
          return;
        }
      } catch {}
    }

    // Try different strategies for retry
    try {
      if (i === 0) {
        // First attempt: just refresh
        await page.reload({ waitUntil: 'networkidle2', timeout: 90000 });
      } else if (i === 1) {
        // Second attempt: go to Google homepage first
        await safeGoto(page, 'https://www.google.com/');
        await randomDelay(2000, 4000);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
      } else {
        // Final attempt: clear cookies and start fresh
        const client = await page.target().createCDPSession();
        await client.send('Network.clearBrowserCookies');
        await client.send('Network.clearBrowserCache');
        await randomDelay(3000, 6000);
        await safeGoto(page, 'https://www.google.com/');
        await randomDelay(2000, 4000);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
      }
    } catch (error) {
      console.warn(`Retry attempt ${i + 1} failed:`, error);
    }
  }
  
  console.warn('CAPTCHA mitigation completed. Continuing with current page state.');
}

function isCaptchaInterstitial(url: string, htmlSnippet: string): boolean {
  const u = url || '';
  if (u.includes('/sorry/') || u.includes('/interstitial') || u.includes('sorry/index')) return true;
  const h = (htmlSnippet || '').toLowerCase();
  return h.includes('unusual traffic')
    || h.includes("i'm not a robot")
    || h.includes('recaptcha')
    || h.includes("having trouble accessing google search");
}

export interface CompetitorDetails {
  rating: string;
  reviews: string;
  category: string;
  address: string;
  phone: string;
  website: string;
  mapsUrl: string;
  hours?: string;
  about?: string;
  services?: string[];
  description?: string;
  posts?: string;
  scheduleAvailable?: boolean;
  callAvailable?: boolean;
  hasDirections?: boolean;
  reviewCount?: string;
  averageRating?: string;
  websiteBtn?: string;
  scheduleBtn?: string;
  callBtn?: string;
  [key: string]: any; // Add index signature to allow dynamic properties
}

export interface RankingRow {
  keyword: string;
  yourRanking: string;
  topCompetitor: string;
  theirRank: string;
  competitorDetails: CompetitorDetails;
  rating: string;
  reviews: string;
  category: string;
  address: string;
  phone: string;
  website: string;
  mapsUrl: string;
  lastUpdated?: string;
}

// === Args parser ===
function parseArgs(): { gmbUrl?: string; pdf?: boolean } {
  const args = process.argv.slice(2);
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const [key, val] = a.split('=');
      if (val !== undefined) out[key.replace(/^--/, '')] = val;
      else if (i + 1 < args.length && !args[i + 1].startsWith('--')) out[key.replace(/^--/, '')] = args[++i];
      else out[key.replace(/^--/, '')] = true;
    }
  }
  return out as { gmbUrl?: string; pdf?: boolean };
}

// Enhanced delay function with more human-like patterns
const randomDelay = (min: number, max: number) => {
  const baseDelay = Math.floor(Math.random() * (max - min + 1) + min);
  const jitter = Math.random() * 0.3 * baseDelay - (0.15 * baseDelay);
  return new Promise((resolve) => setTimeout(resolve, Math.max(400, baseDelay + jitter)));
};

// Intelligent delay based on action type (used throughout the script for specific timing)
const intelligentDelay = (actionType: 'search' | 'click' | 'scroll' | 'navigation' | 'typing') => {
  const delays = {
    search: [2000, 5000],
    click: [300, 800],
    scroll: [500, 1200],
    navigation: [1500, 3500],
    typing: [100, 300]
  };
  const [min, max] = delays[actionType];
  return randomDelay(min, max);
};

// Conservative session management for CAPTCHA avoidance
class SessionManager {
  private requestCount = 0;
  private sessionStartTime = Date.now();
  private lastRequestTime = 0;
  
  async paceRequest(): Promise<void> {
    this.requestCount++;
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    //const sessionDuration = now - this.sessionStartTime;
    
    // Lightweight delays with small jitter
    const base = 1200 + Math.floor(Math.random() * 800); // 1.2–2.0s
    const extra = Math.min(2000, Math.floor(this.requestCount * 150)); // slight growth
    const targetInterval = base + extra;
    if (timeSinceLastRequest < targetInterval) {
      await randomDelay(targetInterval - timeSinceLastRequest, targetInterval + 800);
    }
    this.lastRequestTime = Date.now();
  }
  
  shouldTakeBreak(): boolean {
    const sessionDuration = Date.now() - this.sessionStartTime;
    return sessionDuration > 20 * 60 * 1000 && this.requestCount > 5; // 20 minutes or 5 requests
  }
}

// --- Robust Local Finder scrolling & detection helper ---
// Assumptions: page and lfPage (popup page) may exist; sigTokens is an array of normalized tokens; corePrefixNorm is normalized core prefix.
async function scanLocalFinderForBusiness({
  page,
  lfPage,
  sigTokens,
  corePrefixNorm,
  maxScrolls = 12,
  scrollDelayMin = 800,
  scrollDelayMax = 1400,
}: {
  page: any;
  lfPage: any;
  sigTokens: string[];
  corePrefixNorm: string;
  maxScrolls?: number;
  scrollDelayMin?: number;
  scrollDelayMax?: number;
}) {
  const finderPage = (lfPage && !lfPage.isClosed && !lfPage.isClosed()) ? lfPage : page;
  try { await finderPage.bringToFront?.(); } catch {}
  // Guard: if core prefix is too short or missing, do not risk false positives
  if (!corePrefixNorm || corePrefixNorm.length < 4) {
    try { console.log('[Local Finder] Debug: corePrefixNorm missing/short, refusing to match to avoid false positives'); } catch {}
    return { foundIndex: -1, foundTitle: null };
  }

  const checkScript = (sigTokensArg: string[], corePrefix: string) => {
    const norm = (s: any) => (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
    const tokenize = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    const busSet = new Set<string>(sigTokensArg.map(norm));
    const cardSelectors = ['.Nv2PK', '.Nv2PK.tH5CWc', '.hfpxzc', '[role="article"] .qBF1Pd', '.dbg0pd', '.OSrXXb', '.Nr22bf'];
    let cards: HTMLElement[] = [];
    for (const sel of cardSelectors) {
      cards = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
      if (cards.length) break;
    }
    if (cards.length === 0) {
      const arts = Array.from(document.querySelectorAll('div[role="feed"] [role="article"], [data-result-index]')) as HTMLElement[];
      cards = arts.filter(a => a.textContent && a.textContent.trim().length > 5);
    }
    cards = cards.filter(c => !(/sponsored|\bad\b/i.test(c.textContent || '')));
    const titles: string[] = cards.map(c => {
      const link = c.querySelector('a[aria-label], a.hfpxzc, a') as HTMLElement | null;
      let t = '';
      if (link) {
        t = (link.getAttribute && (link.getAttribute('aria-label') || link.getAttribute('title'))) || '';
      }
      if (!t) t = (c.getAttribute && c.getAttribute('aria-label')) || '';
      if (!t) t = c.textContent || '';
      return (t || '').trim();
    });
    // Compute how common the core prefix is and rarity of our tokens
    const norms = titles.map(t => t.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const coreCount = norms.reduce((acc, n) => acc + (corePrefix && corePrefix.length >= 4 && n.includes(corePrefix) ? 1 : 0), 0);
    const freq = new Map<string, number>();
    for (const t of titles) {
      const ws = new Set(tokenize(t));
      for (const w of ws) freq.set(w, (freq.get(w) || 0) + 1);
    }
    const rareSet = new Set<string>();
    for (const tk of busSet) {
      if (tk.length < 5) continue; // prefer longer distinctive tokens
      const f = freq.get(tk) || 0;
      if (f <= 2) rareSet.add(tk);
    }
    const needsRare = coreCount >= 3; // if core appears on many titles, require a rare token too

    for (let i = 0; i < norms.length; i++) {
      const n = norms[i];
      const coreHit = !!corePrefix && corePrefix.length >= 4 && n.includes(corePrefix);
      if (!coreHit) continue;
      if (needsRare) {
        let rareHits = 0; for (const tk of rareSet) if (n.includes(tk)) { rareHits++; break; }
        if (rareHits === 0) continue;
      }
      return { foundIndex: i + 1, title: titles[i] || null };
    }
    return { foundIndex: -1, title: null };
  };

  let lastCount = -1;
  let stable = 0;
  for (let attempt = 0; attempt < maxScrolls; attempt++) {
    const res = await finderPage.evaluate(checkScript, sigTokens, corePrefixNorm);
    if (res && res.foundIndex && res.foundIndex > 0) {
      // Click candidate and verify RHS title contains corePrefixNorm
      try {
        await finderPage.evaluate((idx: number) => {
          let cards = Array.from(document.querySelectorAll('.Nv2PK')) as HTMLElement[];
          if (cards.length === 0) {
            const arts = Array.from(document.querySelectorAll('div[role="feed"] [role="article"], div[aria-label*="Results for"] [role="article"]')) as HTMLElement[];
            cards = arts.filter(a => a.textContent && a.textContent.trim().length > 5) as HTMLElement[];
          }
          cards = cards.filter(c => !(/sponsored|\bad\b/i.test(c.textContent || '')));
          (cards[idx - 1] as HTMLElement)?.scrollIntoView({ behavior: 'auto', block: 'center' });
          (cards[idx - 1] as HTMLElement)?.click();
        }, res.foundIndex as number);
        try { await finderPage.waitForSelector('[role="main"] h1, .DUwDvf, [data-attrid="title"]', { timeout: 6000 }); } catch {}
        await new Promise(r => setTimeout(r, 700));
        const rhsName = await finderPage.evaluate(() => (document.querySelector('[role="main"] h1, .DUwDvf, [data-attrid="title"]')?.textContent || '').trim());
        const nameNorm = (rhsName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (corePrefixNorm && corePrefixNorm.length >= 4 && nameNorm.includes(corePrefixNorm)) {
          return { foundIndex: res.foundIndex, foundTitle: res.title };
        }
      } catch {}
      // verification failed; continue scanning
    }

    // capture signature before scroll (count + last title)
    const beforeSig = await finderPage.evaluate(() => {
      const titles = Array.from(document.querySelectorAll('.Nv2PK .qBF1Pd, .Nv2PK .OSrXXb, [role="article"] .qBF1Pd, [role="article"] h3'))
        .map(e => (e.textContent||'').trim()).filter(Boolean);
      return { count: titles.length, last: titles[titles.length-1] || '' };
    });

    await finderPage.evaluate(() => {
      const candidates = [
        'div[role="feed"]',
        'div[aria-label*="Results for" i] .m6QEr',
        '.DxyBCb .m6QEr',
        '.m6QEr',
        '.m6QEr .section-scrollbox',
        '.section-scrollbox'
      ];
      // Try explicit scrollable element discovery
      const findScrollableAncestor = (el: HTMLElement | null): HTMLElement | null => {
        let p: HTMLElement | null = el;
        for (let i = 0; i < 8 && p; i++) {
          const cs = window.getComputedStyle(p);
          if ((/auto|scroll/.test(cs.overflowY || '')) && p.scrollHeight > p.clientHeight) return p;
          p = p.parentElement as HTMLElement | null;
        }
        return null;
      };
      let panel: HTMLElement | null = null;
      const feed = document.querySelector('div[role="feed"]') as HTMLElement | null;
      if (feed) panel = findScrollableAncestor(feed) || feed;
      if (!panel) {
        const firstCard = (document.querySelector('.Nv2PK') || document.querySelector('[role="article"]')) as HTMLElement | null;
        panel = findScrollableAncestor(firstCard as HTMLElement | null);
      }
      if (!panel) {
        for (const sel of candidates) {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (!el) continue;
          const cs = window.getComputedStyle(el);
          const ok = (el.scrollHeight > el.clientHeight) && (/auto|scroll/.test(cs.overflowY || '') || (el as any).scrollTop !== undefined);
          if (ok) { panel = el; break; }
        }
      }
      if (panel) {
        try {
          (panel as any).focus?.();
          const step = Math.max(400, Math.floor(panel.clientHeight * 0.95));
          panel.scrollBy(0, step);
          panel.dispatchEvent(new WheelEvent('wheel', { deltaY: step }));
          // hard jump towards bottom as a fallback
          panel.scrollTop = Math.min(panel.scrollTop + step * 2, panel.scrollHeight);
          return { ok: true };
        } catch (e) {}
      }
      try { window.scrollBy(0, Math.max(600, window.innerHeight / 2)); return { ok: true, selUsed: 'window' }; } catch (e) {}
      return { ok: false };
    });
    // Nudge lazy-load by focusing feed and pressing PageDown
    try {
      await finderPage.evaluate(() => { (document.querySelector('div[role="feed"]') as HTMLElement)?.click(); });
      for (let i = 0; i < 4; i++) { await (finderPage as any).keyboard.press('End'); await (finderPage as any).keyboard.press('PageDown'); }
    } catch {}

    const waitMs = Math.floor(Math.random() * (scrollDelayMax - scrollDelayMin + 1)) + scrollDelayMin;
    await new Promise(r => setTimeout(r, waitMs));

    // wait for last-title signature to change (indicates new items loaded)
    try {
      await finderPage.waitForFunction((prev: any) => {
        const titles = Array.from(document.querySelectorAll('.Nv2PK .qBF1Pd, .Nv2PK .OSrXXb, [role="article"] .qBF1Pd, [role="article"] h3'))
          .map(e => (e.textContent||'').trim()).filter(Boolean);
        const sig = { count: titles.length, last: titles[titles.length-1] || '' } as any;
        return sig.count > (prev as any).count || sig.last !== (prev as any).last;
      }, { timeout: 4000 }, beforeSig);
    } catch {}

    const after = await finderPage.evaluate(checkScript, sigTokens, corePrefixNorm);
    if (after && after.foundIndex && after.foundIndex > 0) {
      try {
        await finderPage.evaluate((idx: number) => {
          let cards = Array.from(document.querySelectorAll('.Nv2PK')) as HTMLElement[];
          if (cards.length === 0) {
            const arts = Array.from(document.querySelectorAll('div[role="feed"] [role="article"], div[aria-label*="Results for"] [role="article"]')) as HTMLElement[];
            cards = arts.filter(a => a.textContent && a.textContent.trim().length > 5) as HTMLElement[];
          }
          cards = cards.filter(c => !(/sponsored|\bad\b/i.test(c.textContent || '')));
          (cards[idx - 1] as HTMLElement)?.scrollIntoView({ behavior: 'auto', block: 'center' });
          (cards[idx - 1] as HTMLElement)?.click();
        }, after.foundIndex as number);
        try { await finderPage.waitForSelector('[role=\"main\"] h1, .DUwDvf, [data-attrid=\"title\"]', { timeout: 6000 }); } catch {}
        await new Promise(r => setTimeout(r, 700));
        const rhsName2 = await finderPage.evaluate(() => (document.querySelector('[role="main"] h1, .DUwDvf, [data-attrid="title"]')?.textContent || '').trim());
        const nameNorm2 = (rhsName2 || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (corePrefixNorm && corePrefixNorm.length >= 4 && nameNorm2.includes(corePrefixNorm)) {
          return { foundIndex: after.foundIndex, foundTitle: after.title };
        }
      } catch {}
    }

    const countNow = await finderPage.evaluate(() => {
      const selCands = ['.Nv2PK', 'div[role="feed"] [role="article"]', '.dbg0pd'];
      for (const s of selCands) {
        const nodes = document.querySelectorAll(s);
        if (nodes && nodes.length) return nodes.length;
      }
      return document.querySelectorAll('div[role="feed"] [role="article"]').length;
    });
    try { console.log('[Local Finder] Debug: cards loaded =', countNow); } catch {}
    if (countNow === lastCount) stable++; else stable = 0;
    lastCount = countNow as any;
    if (stable >= 3) break;
  }

  // Debug: print current page visible titles for verification
  try {
    const dbg = await finderPage.evaluate(() => {
      const cardSelectors = ['.Nv2PK', '.Nv2PK.tH5CWc', '.hfpxzc', '[role="article"] .qBF1Pd', '.dbg0pd', '.OSrXXb', '.Nr22bf'];
      let cards: HTMLElement[] = [];
      for (const sel of cardSelectors) {
        const found = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
        if (found.length) { cards = found.map(n => (sel.includes(' .') ? (n.closest('.Nv2PK') as HTMLElement) || n : n)); break; }
      }
      if (cards.length === 0) {
        const feed = document.querySelector('div[role="feed"]') as HTMLElement | null;
        const arts = Array.from(document.querySelectorAll('div[role="feed"] [role="article"], [data-result-index]')) as HTMLElement[];
        const anchors = feed ? Array.from(feed.querySelectorAll('a[aria-label], a.hfpxzc')) as HTMLElement[] : [];
        cards = arts.filter(a => a.textContent && a.textContent.trim().length > 5);
        if (cards.length === 0 && anchors.length) {
          // Build pseudo-cards from anchors so we can extract titles
          cards = anchors.map(a => (a.closest('.Nv2PK') as HTMLElement) || a);
        }
      }
      cards = cards.filter(c => !(/sponsored|\bad\b/i.test(c.textContent || '')));
      const getTitle = (c: HTMLElement): string => {
        const link = c.querySelector('a[aria-label], a.hfpxzc, a') as HTMLElement | null;
        let t = '';
        if (link) { t = (link.getAttribute && (link.getAttribute('aria-label') || link.getAttribute('title'))) || ''; }
        if (!t) t = (c.getAttribute && c.getAttribute('aria-label')) || '';
        if (!t) t = c.textContent || '';
        return (t || '').trim();
      };
      return cards.slice(0, 30).map((c, i) => `${i + 1}. ${getTitle(c)}`);
    });
    console.log('[Local Finder] Debug: visible titles on current page:', dbg);
  } catch {}

  const finalRes = await finderPage.evaluate((sigTokensArg: string[], corePrefix: string) => {
    const norm = (s: any) => (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
    const tokenize = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    const busSet = new Set(sigTokensArg.map(norm));
    const cardSelectors = ['.Nv2PK', '.Nv2PK.tH5CWc', '.hfpxzc', '[role="article"] .qBF1Pd', '.dbg0pd', '.OSrXXb', '.Nr22bf'];
    let cards: HTMLElement[] = [];
    for (const sel of cardSelectors) {
      const found = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
      if (found.length) { cards = found.map(n => (sel.includes(' .') ? (n.closest('.Nv2PK') as HTMLElement) || n : n)); break; }
    }
    if (cards.length === 0) {
      const feed = document.querySelector('div[role="feed"]') as HTMLElement | null;
      const arts = Array.from(document.querySelectorAll('div[role="feed"] [role="article"], [data-result-index]')) as HTMLElement[];
      const anchors = feed ? Array.from(feed.querySelectorAll('a[aria-label], a.hfpxzc')) as HTMLElement[] : [];
      cards = arts.filter(a => a.textContent && a.textContent.trim().length > 5);
      if (cards.length === 0 && anchors.length) {
        cards = anchors.map(a => (a.closest('.Nv2PK') as HTMLElement) || a);
      }
    }
    cards = cards.filter(c => !(/sponsored|\bad\b/i.test(c.textContent || '')));
    const getTitle = (c: HTMLElement): string => {
      const link = c.querySelector('a[aria-label], a.hfpxzc, a') as HTMLElement | null;
      let t = '';
      if (link) { t = (link.getAttribute && (link.getAttribute('aria-label') || link.getAttribute('title'))) || ''; }
      if (!t) t = (c.getAttribute && c.getAttribute('aria-label')) || '';
      if (!t) t = c.textContent || '';
      return (t || '').trim();
    };
    // Build norms and rarity like in checkScript
    const titles = cards.map(c => getTitle(c));
    const norms = titles.map(t => t.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const coreCount = norms.reduce((acc, n) => acc + (corePrefix && corePrefix.length >= 4 && n.includes(corePrefix) ? 1 : 0), 0);
    const freq = new Map<string, number>();
    for (const t of titles) {
      const ws = new Set(tokenize(t));
      for (const w of ws) freq.set(w, (freq.get(w) || 0) + 1);
    }
    const rareSet = new Set<string>();
    for (const tk of busSet) {
      if (tk.length < 5) continue;
      const f = freq.get(tk) || 0;
      if (f <= 2) rareSet.add(tk);
    }
    const needsRare = coreCount >= 3;

    for (let i = 0; i < norms.length; i++) {
      const n = norms[i];
      const coreHit = !!corePrefix && corePrefix.length >= 4 && n.includes(corePrefix);
      if (!coreHit) continue;
      if (needsRare) {
        let rareHits = 0; for (const tk of rareSet) if (n.includes(tk)) { rareHits++; break; }
        if (rareHits === 0) continue;
      }
      return { foundIndex: i + 1, title: titles[i] || null };
    }
    return { foundIndex: -1, title: null };
  }, sigTokens, corePrefixNorm);

  return { foundIndex: finalRes.foundIndex || -1, foundTitle: finalRes.title || null };
}


// -------------------- Utilities --------------------
async function humanMoveMouse(page: Page, selector: string): Promise<void> {
  try {
    const element = await page.$(selector);
    if (!element) return;
    const box = await element.boundingBox();
    if (!box) return;
    await page.mouse.move(
      box.x + box.width * (0.2 + Math.random() * 0.6),
      box.y + box.height * (0.2 + Math.random() * 0.6),
      { steps: 10 + Math.floor(Math.random() * 10) }
    );
    await randomDelay(100, 500);
  } catch (error) {
    console.error('Error in humanMoveMouse:', error);
  }
}

// Enhanced navigation with better fingerprint resistance
async function safeGoto(page: Page, url: string, options: any = {}): Promise<boolean> {
  try {
    // Use more recent and varied user agents
    const userAgent = STEALTH_CONFIG.USER_AGENTS[Math.floor(Math.random() * STEALTH_CONFIG.USER_AGENTS.length)];
    await page.setUserAgent(userAgent);

    // More realistic viewport sizes
    const resolution = STEALTH_CONFIG.SCREEN_RESOLUTIONS[Math.floor(Math.random() * STEALTH_CONFIG.SCREEN_RESOLUTIONS.length)];
    await page.setViewport({
      width: resolution.width + Math.floor(Math.random() * 100) - 50,
      height: resolution.height + Math.floor(Math.random() * 100) - 50,
      deviceScaleFactor: 1,
      hasTouch: false,
      isLandscape: false,
    });

    // Enhanced headers with more realistic values
    const language = STEALTH_CONFIG.LANGUAGES[Math.floor(Math.random() * STEALTH_CONFIG.LANGUAGES.length)];
    const headers: Record<string, string> = {
      'Accept-Language': `${language},en;q=0.9`,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'max-age=0',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1'
    };
    
    // Add optional headers conditionally
    if (Math.random() > 0.5) {
      headers['Referer'] = 'https://www.google.com/';
    }
    if (Math.random() > 0.7) {
      headers['DNT'] = '1';
    }
    
    await page.setExtraHTTPHeaders(headers);

    // Add realistic browser features
    await page.evaluateOnNewDocument(() => {
      // Override webdriver property
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      
      // Add realistic screen properties
      Object.defineProperty(screen, 'availWidth', { get: () => screen.width });
      Object.defineProperty(screen, 'availHeight', { get: () => screen.height - 40 });
      
      // Add realistic plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [{
          name: 'Chrome PDF Plugin',
          filename: 'internal-pdf-viewer',
          description: 'Portable Document Format'
        }]
      });
      
      // Randomize hardware concurrency
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => Math.floor(Math.random() * 8) + 4
      });
    });

    // Longer delay before navigation
    await randomDelay(2000, 5000);

    // Try different wait strategies
    const waitStrategies = ['domcontentloaded', 'networkidle0', 'networkidle2'];
    const waitUntil = waitStrategies[Math.floor(Math.random() * waitStrategies.length)] as any;
    
    await page.goto(url, { waitUntil, timeout: 120000, ...options });
    try { await tryHandleCaptcha(page); } catch {}
    
    // Simulate human behavior after page load
    await simulateHumanBehavior(page);
    
    return true;
  } catch (e) {
    console.warn('First navigation attempt failed, retrying with fallback...');
    try {
      await randomDelay(3000, 6000);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 120000, ...options });
      try { await tryHandleCaptcha(page); } catch {}
      await simulateHumanBehavior(page);
      return true;
    } catch (e) {
      console.error('Failed to navigate to URL:', url, e);
      return false;
    }
  }
}

// Simulate realistic human behavior after page load
async function simulateHumanBehavior(page: Page): Promise<void> {
  try {
    // Random small delay
    await randomDelay(800, 2000);
    
    // Simulate reading behavior with random scrolls
    const scrollCount = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < scrollCount; i++) {
      const scrollAmount = Math.floor(Math.random() * 300) + 100;
      await page.evaluate((amount) => {
        window.scrollBy(0, amount);
      }, scrollAmount);
      await randomDelay(500, 1500);
    }
    
    // Random mouse movements
    const viewport = page.viewport();
    if (viewport) {
      const x = Math.floor(Math.random() * viewport.width * 0.8) + viewport.width * 0.1;
      const y = Math.floor(Math.random() * viewport.height * 0.8) + viewport.height * 0.1;
      await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
    }
    
    // Occasionally hover over elements
    if (Math.random() > 0.7) {
      try {
        const elements = await page.$$('a, button, input');
        if (elements.length > 0) {
          const randomElement = elements[Math.floor(Math.random() * elements.length)];
          await randomElement.hover();
          await randomDelay(200, 800);
        }
      } catch {}
    }
  } catch (error) {
    // Ignore errors in behavior simulation
  }
}

// -------------------- Scrapers --------------------

/**
 * scrapeGoogleSearch
 * - More robust extraction for both Local Pack and organic results
 * - Returns an array of objects: { position, title, url, rating, reviews, category, address, description }
 */
type ScrapeOptions = { assumeResultsLoaded?: boolean };
async function scrapeGoogleSearch(page: Page, query: string, maxResults = 20, options?: ScrapeOptions): Promise<any[]> {
  await randomDelay(150, 400);
  if (!options?.assumeResultsLoaded) {
    // Perform the query via google.com/co.in homepage to look more organic
    const ok = await performHumanSearch(page, query);
    if (!ok) return [];
  }

  // Detect Google's soft block page with the plain message and retry via google.co.in
  try {
    const html = (await page.content()).toLowerCase();
    if (html.includes("having trouble accessing google search")) {
      await randomDelay(1200, 2500);
      await safeGoto(page, `https://www.google.co.in/search?q=${encodeURIComponent(query)}&hl=en-IN`);
      await randomDelay(800, 1600);
      // If still on the soft-block page, try clicking the inline 'click here' link
      try {
        const stillBlocked = (await page.content()).toLowerCase().includes("having trouble accessing google search");
        if (stillBlocked) {
          const clicked = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[];
            const target = links.find(a => /click\s*here/i.test(a.textContent || ''));
            if (target) { target.click(); return true; }
            return false;
          });
          if (clicked) {
            try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }); } catch {}
          }
        }
      } catch {}
    }
  } catch {}

  // If results container is still not visible, retry via direct search URLs (.com then .co.in)
  try {
    const hasResults = await page.$('#search, .srp, .g, .tF2Cxc');
    if (!hasResults) {
      await safeGoto(page, `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`);
      try { await (page as any).solveRecaptchas?.(); } catch {}
      await randomDelay(1000, 2000);
    }
  } catch {}
  try {
    const hasResults2 = await page.$('#search, .srp, .g, .tF2Cxc');
    if (!hasResults2) {
      await safeGoto(page, `https://www.google.co.in/search?q=${encodeURIComponent(query)}&hl=en-IN`);
      try { await (page as any).solveRecaptchas?.(); } catch {}
      await randomDelay(1000, 2000);
    }
  } catch {}

  // Accept cookie banners if present (best-effort)
  try {
    const acceptButtons = [
      'button:has-text("I agree")',
      'button:has-text("Accept all")',
      'button:has-text("Accept")',
      'button[aria-label*="accept"]',
      'form button[type="submit"]'
    ];
    for (const sel of acceptButtons) {
      const b = await page.$(sel as any);
      if (b) {
        try {
          await humanMoveMouse(page, sel);
          await randomDelay(200, 700);
          await b.click();
          await randomDelay(800, 1800);
          break;
        } catch {}
      }
    }
  } catch (e) {
    // ignore
  }

  // scroll a bit to allow dynamic content to load
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => window.scrollBy(0, Math.floor(Math.random() * 400) + 200));
    await randomDelay(500, 1200);
  }

  // Detect potential captcha and auto-mitigate with backoff+retry (stealth-only)
  const captchaFrame = await page.$('iframe[src*="recaptcha"], iframe[src*="captcha"], #captcha, .g-recaptcha');
  if (captchaFrame) {
    // Retry by re-performing the search like a human instead of loading the query URL
    await mitigateCaptcha(page, page.url(), 2);
    await performHumanSearch(page, query);
  }

  // Brief exploration before parsing results
  await explorePageHuman(page);

  // Detect Google interstitial (unusual traffic) and apply a longer one-time cooldown then retry
  try {
    const snippet = (await page.content()).slice(0, 3000);
    if (isCaptchaInterstitial(page.url(), snippet)) {
      console.warn('Detected Google interstitial. Applying short cooldown and retrying once...');
      await new Promise(r => setTimeout(r, 8000 + Math.floor(Math.random() * 7000))); // 8-15s
      await performHumanSearch(page, query);
    }
  } catch {}

  // Now extract results with multiple fallbacks
  const results = await page.evaluate((maxResults) => {
    const out: any[] = [];

    // helper
    const text = (el: Element | null) => el?.textContent?.trim() || '';

    // 0) Try Knowledge Panel (right-side) when present
    try {
      const rhs = document.querySelector('#rhs, .kp-wholepage, .knowledge-panel') || document.querySelector('div[role="complementary"]');
      if (rhs) {
        const kp: any = { position: 0 };
        const getAttr = (el: Element | null, attr: string) => (el && (el as HTMLElement).getAttribute(attr)) || '';
        const getText = (sel: string) => (rhs.querySelector(sel)?.textContent || '').trim();
        // Title
        kp.title = getText('h2, h3, .SPZz6b, .qrShPb, [data-attrid="title"]');
        // Website button
        const websiteEl = rhs.querySelector('a[aria-label^="Website" i], a[data-attrid*="website"], a[role="button"][href*="/url?"]');
        let websiteHref = getAttr(websiteEl, 'href');
        if (websiteHref) {
          try {
            const u = new URL(websiteHref, 'https://www.google.com');
            if (u.pathname === '/url') {
              websiteHref = u.searchParams.get('q') || u.searchParams.get('url') || websiteHref;
            }
          } catch {}
          kp.website = websiteHref;
          kp.websiteBtn = 'Yes';
        }
        // Span label-based fallbacks (matches your snippet)
        const spans = Array.from(rhs.querySelectorAll('span.PbOY2e')) as HTMLSpanElement[];
        const byLabel = (label: string) => spans.find(sp => (sp.textContent || '').trim().toLowerCase() === label);
        // Website via span
        if (!kp.website) {
          const s = byLabel('website');
          if (s) {
            const a = s.closest('a') as HTMLAnchorElement | null;
            let href = a?.getAttribute('href') || '';
            if (href) {
              try { const u = new URL(href, 'https://www.google.com'); if (u.pathname === '/url') href = u.searchParams.get('q') || u.searchParams.get('url') || href; } catch {}
              kp.website = href; kp.websiteBtn = 'Yes';
            }
          }
        }
        // Directions button
        const dirEl = rhs.querySelector('a[aria-label^="Directions" i], a[data-attrid*="directions"], a[href*="/maps/dir/"]');
        const dirHref = getAttr(dirEl, 'href');
        kp.hasDirections = !!dirHref || !!byLabel('directions');
        // Call button
        const callEl = rhs.querySelector('a[href^="tel:"], a[aria-label^="Call" i], button[aria-label^="Call" i]');
        const telHref = getAttr(callEl, 'href');
        if (telHref && telHref.startsWith('tel:')) {
          kp.callAvailable = true;
          kp.callBtn = 'Yes';
        }
        if (!kp.callAvailable && byLabel('call')) { kp.callAvailable = true; kp.callBtn = 'Yes'; }
        // Schedule / Book online
        const bookSpan = spans.find(sp => /\bbook\b|\bbook online\b|\bappointment\b/i.test((sp.textContent || '')));
        if (bookSpan) { kp.scheduleAvailable = true; kp.scheduleBtn = 'Yes'; }
        // A reasonable mapsUrl from panel
        const mapsLink = rhs.querySelector('a[href*="/maps/place/"], a[href*="https://maps.app.goo.gl"], a[href*="https://goo.gl/maps"]');
        const mapsHref = getAttr(mapsLink, 'href');
        if (mapsHref) kp.url = mapsHref;

        if (kp.title || kp.website || kp.url) {
          out.push({
            position: 1,
            title: kp.title || '',
            url: kp.url || '',
            website: kp.website || '',
            websiteBtn: kp.website ? 'Yes' : (kp.websiteBtn || 'No'),
            callAvailable: !!kp.callAvailable,
            callBtn: kp.callBtn || (kp.callAvailable ? 'Yes' : 'No'),
            hasDirections: !!kp.hasDirections,
            scheduleAvailable: !!kp.scheduleAvailable,
            scheduleBtn: kp.scheduleBtn || (kp.scheduleAvailable ? 'Yes' : 'No'),
            rating: '',
            reviews: '',
            category: '',
            address: ''
          });
        }
      }
    } catch {}

    // 1) Try Local Pack cards
    const localPackSelectors = [
      '.VkpGBb',             // container used by local pack items
      '.uEierd',             // another local pack class (older / alternate)
      '.GmE3X',              // fallback
      '.xpdopen'             // generic group
    ];
    for (const sel of localPackSelectors) {
      const nodes = Array.from(document.querySelectorAll(sel));
      if (nodes.length) {
        for (let i = 0; i < nodes.length && out.length < maxResults; i++) {
          const n = nodes[i] as HTMLElement;
          // Title/name
          const name = text(n.querySelector('.dbg0pd, .BNeawe.vvjwJb, .qBF1Pd') || n.querySelector('a') || n.querySelector('div'));
          // url - look for maps link or anchor
          const anchor = n.querySelector('a[href*="google.com/maps"], a') as HTMLAnchorElement | null;
          const url = (anchor && anchor.href) || '';
          // rating & reviews
          const ratingNode = n.querySelector('[aria-label*="stars"], span[role="img"], .BTEnNb');
          const rating = (ratingNode && (ratingNode.getAttribute('aria-label') || ratingNode.textContent)) || '';
          let reviews = '';
          const revMatch = text(n.querySelector('.rllt__details span') || n.querySelector('.rllt__review') || n.querySelector('.Aq14fc'));
          if (revMatch) {
            const found = revMatch.match(/\d[\d,]*/);
            reviews = found ? found[0] : revMatch;
          }
          // address/category heuristics - last small text
          const detailTexts = Array.from(n.querySelectorAll('span, div')).map(el => text(el)).filter(Boolean);
          const category = detailTexts.length ? detailTexts[0] : '';
          const address = detailTexts.length > 1 ? detailTexts[detailTexts.length - 1] : '';
          out.push({
            position: out.length + 1,
            title: name,
            url,
            rating: rating,
            reviews: reviews,
            category,
            address,
            description: ''
          });
        }
        if (out.length) return out;
      }
    }

    // 2) Try organic results (cards with .g or .tF2Cxc)
    const organic = Array.from(document.querySelectorAll('.tF2Cxc, .g, .rc'));
    for (let i = 0; i < organic.length && out.length < maxResults; i++) {
      const node = organic[i] as HTMLElement;
      const titleNode = node.querySelector('h3');
      const anchor = node.querySelector('a') as HTMLAnchorElement | null;
      const title = text(titleNode) || text(node.querySelector('.yuRUbf a') || node.querySelector('.DKV0Md'));
      const url = (anchor && anchor.href) || node.querySelector('a')?.getAttribute('href') || '';
      // sometimes rating appears in snippets (rare)
      const snippet = text(node.querySelector('.IsZvec') || node.querySelector('.aCOpRe'));
      let rating = '';
      let reviews = '';
      // check if url is maps one and attempt to extract rating/reviews present
      if (url && url.includes('google.com/maps')) {
        // sometimes rating appears near the link text
        const rNode = node.querySelector('[aria-label*="stars"]');
        rating = rNode ? (rNode.getAttribute('aria-label') || text(rNode)) : '';
        const revNode = node.querySelector('span:contains("reviews"), span:contains("review")');
        reviews = revNode ? text(revNode) : '';
      }
      out.push({
        position: out.length + 1,
        title,
        url,
        rating,
        reviews,
        category: '',
        address: '',
        description: snippet
      });
    }

    // 3) Fallback: look for any anchors to google maps on the page
    if (!out.length) {
      const anchors = Array.from(document.querySelectorAll('a[href*="google.com/maps"]')) as HTMLAnchorElement[];
      for (let i = 0; i < anchors.length && out.length < maxResults; i++) {
        const a = anchors[i];
        out.push({
          position: out.length + 1,
          title: a.textContent?.trim() || '',
          url: a.href,
          rating: '',
          reviews: '',
          category: '',
          address: '',
          description: ''
        });
      }
    }

    return out.slice(0, maxResults);
  }, maxResults).catch(err => {
    console.error('Error during evaluate in scrapeGoogleSearch:', err);
    return [];
  });

  // Normalize some fields
  return (results || []).map((r: any, i: number) => ({
    position: r.position || i + 1,
    title: (r.title || '').trim(),
    url: r.url || '',
    rating: (r.rating || '').toString().trim(),
    reviews: (r.reviews || '').toString().trim(),
    category: (r.category || '').toString().trim(),
    address: (r.address || '').toString().trim(),
    description: (r.description || '').toString().trim()
  }));
}

/**
 * scrapeMapsPlace
 * - Visit maps.place page (or maps.google.com link) and attempt to extract core details.
 * - Uses multiple selector fallbacks and normalizes output.
 */
async function scrapeMapsPlace(page: Page, placeUrl: string) {
  const result: any = {
    rating: 'N/A',
    reviews: 'N/A',
    address: 'N/A',
    phone: 'N/A',
    website: 'N/A',
    category: 'N/A',
    hours: 'N/A',
    photosCount: '0',
    about: 'N/A',
    services: [],
    popularTimes: [],
    description: 'N/A',
    posts: '0',
    scheduleAvailable: false,
    callAvailable: false,
    hasDirections: false,
    reviewCount: '0',
    averageRating: '0.0',
    websiteBtn: 'No',
    scheduleBtn: 'No',
    callBtn: 'No'
  };

  try {
    console.log(`Visiting place URL: ${placeUrl}`);
    const visited = await safeGoto(page, placeUrl, { timeout: 60000 });
    if (!visited) return result;
    // Set mapsUrl to the navigated URL for traceability
    try { result.mapsUrl = page.url(); } catch { result.mapsUrl = placeUrl; }

    // Wait heuristically for content - maps uses heavy dynamic rendering
    await new Promise(resolve => setTimeout(resolve, 2500));
    // try to wait for h1 or a title-like element
    try { await page.waitForSelector('h1, [data-testid="title"], .x3AX1-LfntMc-header-title', { timeout: 8000 }); } catch {}

    // Additional short delay to ensure panel actions render
    try {
      // (Optional reliability improvement requested)
      await new Promise(r => setTimeout(r, 1200));
      await page.waitForFunction(() => !!document.querySelector('[data-item-id]'));
    } catch {}

    // Evaluate many possible selectors and gather values
    const evaluateDetails = () => page.evaluate(() => {
      const out: any = {};
      const t = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        return el?.textContent?.trim() || '';
      };
      const has = (sel: string) => document.querySelector(sel) !== null;

      // Name
      out.name = t('h1') || t('[data-testid="title"]') || t('.x3AX1-LfntMc-header-title') || t('.section-hero-header-title');

      // Rating and reviews (robust)
      const toPlain = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
      const pickReviewCount = (txt: string): string | null => {
        const t = toPlain(txt).toLowerCase();
        // 4.7 stars 140 reviews
        const m1 = t.match(/(\d+(?:\.\d+)?)\s*stars?[^\d]*(\d[\d,]*\+?k?)/i);
        if (m1) { out.averageRating = out.averageRating || m1[1]; return m1[2].replace(/,/g,''); }
        // 4.7 (140)
        const m2 = t.match(/(\d+(?:\.\d+)?)\s*\(([^)]+)\)/);
        if (m2) { out.averageRating = out.averageRating || m2[1]; return m2[2].replace(/,/g,''); }
        // ★ star char next to rating: 4.9 ★ (441)
        const m2b = t.match(/(\d+(?:\.\d+)?)\s*★[^\d]*(\(([^)]+)\))/);
        if (m2b) { out.averageRating = out.averageRating || m2b[1]; return (m2b[3] || '').replace(/,/g,''); }
        // 140 reviews or 140 Google reviews
        const m3 = t.match(/(\d[\d,]*\+?k?)\s*(google\s*)?reviews?/i);
        if (m3) return m3[1].replace(/,/g,'');
        // Just a number in parentheses when near rating
        const m4 = t.match(/\((\d[\d,]*\+?k?)\)/);
        if (m4) return m4[1].replace(/,/g,'');
        return null;
      };

      // Primary: aria-labels
      const ariaNodes = Array.from(document.querySelectorAll('[aria-label*="stars" i], [aria-label*="rating" i], [aria-label*="review" i], [role="img"][aria-label*="star" i]')) as HTMLElement[];
      for (const n of ariaNodes) {
        const al = toPlain(n.getAttribute('aria-label') || '');
        if (al) {
          const rc = pickReviewCount(al);
          const r = al.match(/(\d+(?:\.\d+)?)/);
          if (r && !out.averageRating) out.averageRating = r[1];
          if (rc && !out.reviewCount) { out.reviewCount = rc; out.reviews = rc; break; }
        }
        const siblingTxt = toPlain(n.parentElement?.textContent || '');
        const rc2 = pickReviewCount(siblingTxt);
        if (rc2 && !out.reviewCount) { out.reviewCount = rc2; out.reviews = rc2; break; }
      }

      // Secondary: visible header area near the title
      if (!out.reviewCount || !out.averageRating) {
        const header = document.querySelector('[role="main"]') || document.body;
        const candidates: string[] = [];
        // Collect snippets from common containers
        const containers = [
          header.querySelector('[data-attrid="title"]')?.parentElement,
          header.querySelector('[jslog], [aria-live]')?.parentElement,
          header
        ].filter(Boolean) as Element[];
        containers.forEach(el => {
          const txt = toPlain(el.textContent || '');
          if (txt) candidates.push(txt);
        });
        for (const c of candidates) {
          if (!out.averageRating) {
            // 4.9 ★ or 4.9 stars
            const mR = c.match(/(\d+(?:\.\d+)?)\s*(?:★|stars?)/i) || c.match(/(\d+(?:\.\d+)?)/);
            if (mR) out.averageRating = out.averageRating || mR[1];
          }
          if (!out.reviewCount) {
            const rc = pickReviewCount(c);
            if (rc) { out.reviewCount = rc; out.reviews = rc; break; }
          }
        }
      }

      // If we have averageRating but no friendly rating string, compose it
      if (out.averageRating && !out.rating) {
        out.rating = `Rated ${out.averageRating} out of 5`;
      }

      // Utilities
      const unwrapGoogleRedirect = (href: string): string => {
        if (!href) return href;
        try {
          if (href.startsWith('/')) {
            href = 'https://www.google.com' + href;
          }
          const u = new URL(href, 'https://www.google.com');
          if (u.hostname.includes('google.') && u.pathname === '/url') {
            const q = u.searchParams.get('q') || u.searchParams.get('url');
            if (q) return q;
          }
          return href;
        } catch { return href; }
      };

      // queryDeep: pierce shallow and shadow DOMs to find the first matching element
      const queryDeep = (selectors: string[]): Element | null => {
        const walk = (roots: (Document | ShadowRoot | Element)[], depth = 0): Element | null => {
          if (depth > 3) return null; // avoid deep recursion
          for (const root of roots) {
            for (const sel of selectors) {
              const found = (root as any).querySelector?.(sel) || null;
              if (found) return found as Element;
            }
            // explore shadow roots
            const kids = Array.from((root as any).querySelectorAll?.('*') || []) as Element[];
            const shadowRoots = kids.map(k => (k as any).shadowRoot).filter(Boolean) as ShadowRoot[];
            if (shadowRoots.length) {
              const r = walk(shadowRoots, depth + 1);
              if (r) return r;
            }
          }
          return null;
        };
        return walk([document]);
      };

      // More robust Website detection (shallow first)
      const websiteCandidate = Array.from(document.querySelectorAll('a, button'))
        .find(el => {
          const label = (el.getAttribute('aria-label') || '').toLowerCase();
          const text = (el.textContent || '').toLowerCase();
          const dataId = (el.getAttribute('data-item-id') || '').toLowerCase();
          const href = ((el as HTMLAnchorElement).getAttribute && (el as HTMLAnchorElement).getAttribute('href')) || '';
          return (
            href.includes('http') ||
            label.includes('website') ||
            text.includes('website') ||
            text.includes('visit site') ||
            text.includes('view website') ||
            dataId.includes('website') ||
            dataId.includes('authority')
          );
        }) as HTMLAnchorElement | HTMLButtonElement | undefined;

      let siteEl: Element | null = websiteCandidate || null;
      if (!siteEl) {
        // Shadow DOM fallbacks often carry data-item-id="authority" or aria-label contains Website
        siteEl = queryDeep([
          '[data-item-id*="authority"]',
          'a[aria-label*="Website" i]',
          'button[aria-label*="Website" i]'
        ]);
      }

      if (siteEl) {
        let href = (websiteCandidate as HTMLAnchorElement).getAttribute?.('href') || '';
        if (!href && siteEl) href = (siteEl as HTMLAnchorElement).getAttribute?.('href') || '';
        // If still missing, try descendant anchor within authority container
        if (!href && siteEl) {
          const a = (siteEl as HTMLElement).querySelector?.('a');
          href = a?.getAttribute('href') || '';
        }
        href = unwrapGoogleRedirect(href);
        // Avoid social links and google internal
        if (href && !/google\./i.test(href) && !/facebook\.com|twitter\.com|instagram\.com/i.test(href)) {
          out.website = href;
          out.websiteBtn = 'Yes';
        }
      } else {
        // Explicit authority data-item-id fallback
        const authority = queryDeep(['[data-item-id="authority"]', '[data-item-id*="authority"]']);
        if (authority) {
          let href = '';
          const a = (authority as HTMLElement).querySelector?.('a');
          href = a?.getAttribute('href') || '';
          href = unwrapGoogleRedirect(href);
          out.websiteBtn = 'Yes';
          if (href && !/google\./i.test(href)) out.website = href;
        }
      }

      // Enhanced call detection
      const callCandidate = Array.from(document.querySelectorAll('a[href^="tel:"], button, a'))
        .find(el => {
          const href = ((el as HTMLAnchorElement).getAttribute && (el as HTMLAnchorElement).getAttribute('href')) || '';
          const label = (el.getAttribute('aria-label') || '').toLowerCase();
          const text = (el.textContent || '').toLowerCase();
          const dataId = (el.getAttribute('data-item-id') || '').toLowerCase();
          return (
            href.startsWith('tel:') ||
            label.includes('call') ||
            label.includes('phone') ||
            text.includes('call') ||
            text.includes('phone') ||
            dataId.includes('phone')
          );
        }) as HTMLAnchorElement | HTMLButtonElement | undefined;

      let callEl: Element | null = callCandidate || null;
      if (!callEl) {
        callEl = queryDeep([
          'a[href^="tel:"]',
          '[data-item-id*="phone"]',
          'button[aria-label*="Call" i]',
          'a[aria-label*="Call" i]'
        ]);
      }

      if (callEl) {
        out.callAvailable = true;
        out.callBtn = 'Yes';
        const tel = (callEl as HTMLAnchorElement).getAttribute?.('href') || '';
        if (tel && tel.startsWith('tel:') && (!out.phone || out.phone === 'N/A')) {
          out.phone = tel.replace('tel:', '');
        }
      } else {
        // data-item-id explicit fallback for phone
        const phoneNode = queryDeep(['[data-item-id="phone:tel"]', '[data-item-id*="phone"]', 'a[href^="tel:"]']);
        if (phoneNode) {
          out.callAvailable = true;
          out.callBtn = 'Yes';
          const tel = (phoneNode as HTMLAnchorElement).getAttribute?.('href') || '';
          if (tel && tel.startsWith('tel:')) out.phone = tel.replace('tel:', '');
        }
      }

      // Enhanced schedule/booking detection
      const scheduleCandidate = Array.from(document.querySelectorAll('button, a, div[role="button"]'))
        .find(el => {
          const href = ((el as HTMLAnchorElement).getAttribute && (el as HTMLAnchorElement).getAttribute('href')) || '';
          const label = (el.getAttribute('aria-label') || '').toLowerCase();
          const text = (el.textContent || '').toLowerCase();
          const dataId = (el.getAttribute('data-item-id') || '').toLowerCase();
          return (
            href.includes('appointment') ||
            href.includes('schedule') ||
            label.includes('schedule') ||
            label.includes('appointment') ||
            text.includes('schedule') ||
            text.includes('appointment') ||
            text.includes('book') ||
            text.includes('reserve') ||
            dataId.includes('schedule') ||
            dataId.includes('appointment') ||
            dataId.includes('reserve') ||
            dataId.includes('booking')
          );
        });
      let scheduleEl: Element | null = scheduleCandidate || null;
      if (!scheduleEl) {
        scheduleEl = queryDeep([
          '[data-item-id*="appointment"]',
          '[data-item-id*="reserve"]',
          '[data-item-id*="booking"]',
          'button[aria-label*="Book" i]',
          'a[aria-label*="Book" i]'
        ]);
      }

      if (scheduleEl) {
        out.scheduleAvailable = true;
        out.scheduleBtn = 'Yes';
      } else {
        // explicit appointment fallback
        const appt = queryDeep(['[data-item-id="appointment"]', '[data-item-id*="appointment"]', '[data-item-id*="reserve"]', '[data-item-id*="booking"]']);
        if (appt) {
          out.scheduleAvailable = true;
          out.scheduleBtn = 'Yes';
        }
      }

      // Enhanced directions detection
      if (!out.hasDirections) {
        const dirEl = queryDeep([
          'a[href*="/dir/"]',
          'a[aria-label*="Direction" i]',
          'button[aria-label*="Direction" i]'
        ]);
        out.hasDirections = !!dirEl || has('button[aria-label*="direction" i], a[aria-label*="direction" i], button:has-text("Directions"), a[href*="/dir/"]');
      }

      // ---- Text-based fallbacks using span.PbOY2e from user's DOM snippet ----
      try {
        const byLabel = (label: string) => Array.from(document.querySelectorAll('span.PbOY2e'))
          .find(sp => (sp.textContent || '').trim().toLowerCase() === label);

        // Website
        if (!out.website || out.website === 'N/A' || out.websiteBtn !== 'Yes') {
          const siteSpan = byLabel('website');
          if (siteSpan) {
            const anc = siteSpan.closest('a') as HTMLAnchorElement | null;
            let href = anc?.getAttribute('href') || '';
            if (href) {
              try {
                const u = new URL(href, 'https://www.google.com');
                if (u.pathname === '/url') {
                  href = u.searchParams.get('q') || u.searchParams.get('url') || href;
                }
              } catch {}
              out.website = href;
              out.websiteBtn = 'Yes';
            }
          }
        }

        // Directions
        if (!out.hasDirections) {
          const dirSpan = byLabel('directions');
          if (dirSpan) {
            out.hasDirections = true;
          }
        }

        // Call
        if (!out.callAvailable || out.callBtn !== 'Yes') {
          const callSpan = byLabel('call');
          if (callSpan) {
            const anc = callSpan.closest('[data-phone-number], a[href^="tel:"]') as HTMLElement | null;
            if (anc) {
              const tel = (anc.getAttribute('data-phone-number') || (anc as HTMLAnchorElement).getAttribute?.('href') || '').toString();
              out.callAvailable = true;
              out.callBtn = 'Yes';
              if (tel.startsWith('tel:')) out.phone = tel.replace('tel:', '');
              else if (/^\+?\d[\d\s-]+$/.test(tel)) out.phone = tel.trim();
            }
          }
        }

        // Schedule / Book online
        if (!out.scheduleAvailable || out.scheduleBtn !== 'Yes') {
          const bookSpan = Array.from(document.querySelectorAll('span.PbOY2e'))
            .find(sp => /\bbook\b|\bbook online\b|\bappointment\b/i.test((sp.textContent || '')));
          if (bookSpan) {
            out.scheduleAvailable = true;
            out.scheduleBtn = 'Yes';
          }
        }
      } catch {}

      // Enhanced posts detection with multiple strategies
      let postsCount = '0';
      
      // Strategy 1: Look for posts count in the posts/updates section
      const postsSection = Array.from(document.querySelectorAll('div, section, button, a'))
        .find(el => {
          const text = (el.textContent || '').toLowerCase();
          return (text.includes('post') || text.includes('update')) && 
                 (text.match(/\d+/) || text.includes('no posts'));
        });
      
      if (postsSection) {
        const postsText = postsSection.textContent || '';
        const postsMatch = postsText.match(/(\d+)/);
        if (postsMatch) postsCount = postsMatch[1];
      }
      
      // Strategy 2: Look for posts in the business profile section
      if (postsCount === '0') {
        const profileSections = Array.from(document.querySelectorAll('[role="main"], [role="article"], [class*="section"], [class*="tabpanel"]'));
        for (const section of profileSections) {
          const sectionText = (section.textContent || '').toLowerCase();
          if (sectionText.includes('posts') || sectionText.includes('updates')) {
            const postsMatch = sectionText.match(/(\d+)\s*(posts|updates)/i);
            if (postsMatch) {
              postsCount = postsMatch[1];
              break;
            }
          }
        }
      }
      
      // Strategy 3: Look for posts in the navigation/tabs
      if (postsCount === '0') {
        const navItems = Array.from(document.querySelectorAll('[role="tab"], [role="navigation"] a, [role="navigation"] button'));
        const postsNav = navItems.find(el => {
          const text = (el.textContent || '').toLowerCase();
          return (text.includes('post') || text.includes('update')) && text.match(/\d+/);
        });
        
        if (postsNav) {
          const postsMatch = (postsNav.textContent || '').match(/(\d+)/);
          if (postsMatch) postsCount = postsMatch[1];
        }
      }
      
      out.posts = postsCount;

      // Reviews count: sometimes present in a button near rating
      const reviewsBtn = Array.from(document.querySelectorAll('button, a')).find((el) => {
        const txt = el.textContent || '';
        return /review(s)?|ratings?/i.test(txt);
      });
      out.reviews = reviewsBtn?.textContent?.trim() || '';
      const revMatch = out.reviews.match(/\d[\d,]*/);
      out.reviews = revMatch ? revMatch[0] : (out.reviews || '');

      // Address - many selectors
      out.address =
        t('button[data-item-id*="address"]') ||
        t('button[aria-label*="Address"]') ||
        t('[data-tooltip*="Copy address"]') ||
        t('[data-section-id="ad"]') ||
        t('.LrzXr') || '';

      // Phone
      out.phone =
        t('button[data-item-id*="phone"]') ||
        t('button[aria-label*="Phone"]') ||
        t('.LrzXr.zdqRlf.kno-fv') || '';

      // Website
      const websiteEl = Array.from(document.querySelectorAll('a')).find(a => (a as HTMLAnchorElement).href && /http/i.test((a as HTMLAnchorElement).href) && !((a as HTMLAnchorElement).href.includes('maps.google')));
      out.website = websiteEl ? (websiteEl as HTMLAnchorElement).href : '';

      // Category - often near header
      out.category = t('.Z1hOCe') || t('.LrzXr') || t('[data-section-id="category"]') || '';

      // Hours - try multiple ways
      out.hours = t('[data-hours-display]') || t('.WgFkxc') || t('button[aria-label*="hours"]') || '';

      // About / description
      out.description = t('[data-section-id="description"]') || t('[data-section-id="overview"]') || t('.w8qArf') || '';

      // Services (if present)
      const servicesNodes = Array.from(document.querySelectorAll('[data-section-id*="service"], .section-open-hours, .section-info-line'));
      out.services = servicesNodes.map(n => n.textContent?.trim()).filter(Boolean);

      // Photos count (button text)
      const photoBtn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').match(/photo|photos|image/i));
      const photoText = photoBtn?.textContent || '';
      const pcMatch = (photoText.match(/\d[\d,]*/));
      out.photosCount = pcMatch ? pcMatch[0] : '';

      return out;
    });

    let details = await evaluateDetails();
    // Retry a few times if buttons haven't rendered yet
    const needRetry = (d: any) => !d || ((d.websiteBtn !== 'Yes') && (d.callBtn !== 'Yes') && (d.scheduleBtn !== 'Yes'));
    for (let i = 0; i < 3 && needRetry(details); i++) {
      await new Promise(r => setTimeout(r, 700));
      try { await page.waitForFunction(() => !!document.querySelector('[data-item-id]')); } catch {}
      details = await evaluateDetails();
    }

    // Merge results back into result object and normalize
    if (details) {
      result.rating = details.rating || result.rating;
      result.reviews = details.reviews || result.reviews;
      result.address = (details.address || result.address).replace(/\n+/g, ', ').trim();
      result.phone = details.phone || result.phone;
      result.website = details.website || result.website;
      result.category = details.category || result.category;
      result.hours = details.hours || result.hours;
      result.photosCount = details.photosCount || result.photosCount;
      result.websiteBtn = details.websiteBtn || result.websiteBtn;
      result.callBtn = details.callBtn || result.callBtn;
      result.scheduleBtn = details.scheduleBtn || result.scheduleBtn;
      result.callAvailable = typeof details.callAvailable === 'boolean' ? details.callAvailable : result.callAvailable;
      result.scheduleAvailable = typeof details.scheduleAvailable === 'boolean' ? details.scheduleAvailable : result.scheduleAvailable;
      result.hasDirections = typeof details.hasDirections === 'boolean' ? details.hasDirections : result.hasDirections;
    }

    try {
      const moreSelectors = [
        'button[jsaction*="more"]',
        'button[aria-expanded="false"]',
        'button[aria-label*="Show more"]',
        'button[aria-label*="More"]'
      ];
      for (const sel of moreSelectors) {
        const btn = await (window as any).document.querySelector(sel);
        if (btn) {
          try { (btn as HTMLElement).click(); } catch {}
        }
      }
    } catch (e) {
      // ignore
    }

    // small delay to let more content load
    await new Promise(r => setTimeout(r, 1200));
  } catch (e) {
    console.error('Error scraping maps place:', e);
  }

  // Add button detection
  try {
    const buttons = await page.$$eval("button, a", els =>
      els.map(el => ({
        text: el.textContent?.trim().toLowerCase() || "",
        href: el.getAttribute('href') || ""
      }))
    );

    // Check for website button
    result.websiteBtn = buttons.some(b => 
      b.text.includes("website") || 
      b.href.includes("http") || 
      b.href.includes("www.") ||
      /(\.com|\.in|\.org|\/\/)/.test(b.href)
    ) ? "Yes" : "No";

    // Check for schedule button
    result.scheduleBtn = buttons.some(b => 
      b.text.includes("schedule") || 
      b.text.includes("appointment") || 
      b.text.includes("book") ||
      b.text.includes("reserve") ||
      b.text.includes("rsvp")
    ) ? "Yes" : "No";

    // Check for call button
    result.callBtn = buttons.some(b => 
      b.text.includes("call") || 
      b.text.includes("phone") || 
      b.href.startsWith("tel:")
    ) ? "Yes" : "No";
  } catch (err) {
    console.error("Error checking buttons:", err);
    result.websiteBtn = "Error";
    result.scheduleBtn = "Error";
    result.callBtn = "Error";
  }

  // Set default values if not detected
  result.websiteBtn = result.websiteBtn || "No";
  result.scheduleBtn = result.scheduleBtn || "No";
  result.callBtn = result.callBtn || "No";

  // sanitize strings
  Object.keys(result).forEach(key => {
    if (typeof result[key] === 'string') {
      result[key] = result[key].replace(/[\n\t\r]+/g, ' ').trim();
    }
  });

  console.log('Extracted competitor details (maps):', JSON.stringify(result, null, 2));
  return result;
}

// Resolve short-link maps.app.goo.gl → full /maps/place URL and attempt to extract business/city fallback
async function resolveShortGmbUrl(inputUrl: string): Promise<{ url: string; business?: string; city?: string }> {
  try {
    let url = inputUrl;
    let business: string | undefined;
    let city: string | undefined;

    // Follow redirects using fetch HEAD (best-effort) - Node 18+ has fetch builtin
    if (url.includes('maps.app.goo.gl') || url.includes('goo.gl/maps')) {
      for (let i = 0; i < 5; i++) {
        try {
          const resp = await fetch(url, { method: 'HEAD', redirect: 'manual' as any, headers: { 'User-Agent': 'Mozilla/5.0' } });
          const loc = resp.headers.get('location');
          if (resp.status >= 300 && resp.status < 400 && loc) {
            url = new URL(loc, url).toString();
            if (url.includes('/place/') || url.includes('maps.google.com')) break;
            continue;
          }
          break;
        } catch {
          await new Promise(r => setTimeout(r, 400 + i * 200));
        }
      }
    }

    try {
      const urlObj = new URL(url);
      if (urlObj.pathname.includes('/place/')) {
        const placePart = urlObj.pathname.split('/place/')[1] || '';
        const firstPart = placePart.split('/')[0] || '';
        const parts = firstPart.split('+').map(p => p.replace(/[^a-zA-Z0-9\s]/g, '').trim()).filter(Boolean);
        if (parts.length > 0) {
          business = parts[0];
        }
        if (parts.length > 1) {
          city = parts[parts.length - 1];
        }
      }
    } catch {}

    return { url, business, city };
  } catch (error) {
    console.error('Error resolving URL:', error);
    return { url: inputUrl };
  }
}

// Generate keyword ideas using Gemini (via getAiGeneratedText)
export async function generateKeywordIdeas(gmbUrl: string): Promise<{ business: string; city: string; keywords: KeywordIdea[]; expandedUrl: string }> {
  const { url: expandedUrl, business: detectedBusiness, city: detectedCity } = await resolveShortGmbUrl(gmbUrl);

  console.log('Expanded URL:', expandedUrl);

  const prompt = `
You are a local SEO expert.
Given this Google Maps URL: ${expandedUrl}

1. Identify the business name.
2. Identify the city.
3. Provide exactly 5 UNIQUE top search queries (keywords) that customers might use to find this business.
Rules:
- Do NOT include the brand/business name in queries.
- Do NOT include duplicate or synonymous keywords.
- Use the inferred city for location in queries.
- Do NOT use "near me".
Output JSON ONLY in this format:
{
  "business": "<Business Name>",
  "city": "<City>",
  "keywords": [
    {"keyword":"<service>","query":"best <service> in <city>"},
    {"keyword":"<service>","query":"top rated <service> <city>"},
    {"keyword":"<service>","query":"<service> services in <city>"},
    {"keyword":"<service>","query":"<service> providers in <city>"},
    {"keyword":"<service>","query":"affordable <service> in <city>"}
  ]
}
`;

  const text = await getAiGeneratedText(prompt);

  try {
    let cleaned = text.trim();
    if (cleaned.startsWith('```') && cleaned.endsWith('```')) {
      cleaned = cleaned.slice(3, -3).trim();
      if (cleaned.startsWith('json')) cleaned = cleaned.slice(4).trim();
    }
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
    const obj = JSON.parse(cleaned);
    const seen = new Set<string>();
    const keywords: KeywordIdea[] = [];
    if (Array.isArray(obj.keywords)) {
      for (const item of obj.keywords) {
        if (item && typeof item === 'object' && item.keyword && item.query) {
          const keyword = String(item.keyword).trim();
          const query = String(item.query).trim();
          if (keyword && query && !seen.has(keyword.toLowerCase())) {
            seen.add(keyword.toLowerCase());
            keywords.push({ keyword, query });
            if (keywords.length >= 5) break;
          }
        }
      }
    }
    const business = obj.business ? String(obj.business).trim() : detectedBusiness || 'Unknown';
    const city = obj.city ? String(obj.city).trim() : detectedCity || '';
    return { business, city, keywords, expandedUrl };
  } catch (e) {
    console.error('Failed to parse AI response:', e);
    // Ensure we still propagate expandedUrl for direct LHS scraping path
    return { business: detectedBusiness || 'Unknown', city: detectedCity || '', keywords: [], expandedUrl };
  }
}

// Generate rankings using web scraping (puppeteer-extra + stealth)
async function generateScrapedRankings(keywords: KeywordIdea[], businessName: string, city: string): Promise<RankingRow[]> {
  const results: RankingRow[] = [];
  const sessionManager = new SessionManager();

  // Persist a browser profile to reduce CAPTCHAs (cookies, cache, local storage)
  // Use a separate profile for rankings to avoid locking the primary one used in my-business fetch
  const userDataDir = process.env.RANKINGS_USER_DATA_DIR || path.resolve(process.cwd(), '.puppeteer_profile_rankings');
  try { fs.mkdirSync(userDataDir, { recursive: true }); } catch {}

  // Minimal launch settings (align with older working script)
  const resolution = { width: 1366, height: 900 };
  // Restore UA selection like previous code for header consistency
  const ua = STEALTH_CONFIG.USER_AGENTS[Math.floor(Math.random() * STEALTH_CONFIG.USER_AGENTS.length)];
  
  // Minimal Windows-friendly launch options
  const launchOptions: LaunchOptions & { ignoreHTTPSErrors?: boolean; userDataDir?: string; executablePath?: string; dumpio?: boolean } = {
    headless: process.env.HEADLESS === 'true' ? true : false,
    ignoreHTTPSErrors: true,
    dumpio: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      `--window-size=${resolution.width},${resolution.height}`
    ],
    defaultViewport: {
      width: resolution.width,
      height: resolution.height,
      deviceScaleFactor: 1,
      hasTouch: false,
      isLandscape: false,
    },
    userDataDir,
  };

  // Try launch; if it fails, retry with common Chrome paths on Windows
  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch(launchOptions) as Browser;
  } catch (err) {
    const possibleChromePaths = [
      process.env.CHROME_PATH,
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    ].filter(Boolean) as string[];
    for (const p of possibleChromePaths) {
      try {
        console.warn(`Primary launch failed. Retrying with Chrome at: ${p}`);
        browser = await puppeteer.launch({ ...launchOptions, executablePath: p }) as Browser;
        if (browser) break;
      } catch {}
    }
    if (!browser) throw err;
  }
  let page = await browser.newPage();

  // Enable JavaScript for the page
  await page.setJavaScriptEnabled(true);

  // Additional headless stealth measures
  if (process.env.HEADLESS !== 'false') {
    // Set realistic viewport for headless mode
    await page.setViewport({
      width: resolution.width,
      height: resolution.height,
      deviceScaleFactor: 1,
      hasTouch: false,
      isLandscape: false,
      isMobile: false
    });
  }

  // ULTRA-STEALTH browser properties - make completely undetectable
  await page.evaluateOnNewDocument(() => {
    // Remove ALL automation indicators (comprehensive list)
    const automationProps = [
      'cdc_adoQpoasnfa76pfcZLmcfl_Array',
      'cdc_adoQpoasnfa76pfcZLmcfl_Promise', 
      'cdc_adoQpoasnfa76pfcZLmcfl_Symbol',
      'cdc_adoQpoasnfa76pfcZLmcfl_JSON',
      'cdc_adoQpoasnfa76pfcZLmcfl_Object',
      'cdc_adoQpoasnfa76pfcZLmcfl_Proxy',
      'cdc_adoQpoasnfa76pfcZLmcfl_Reflect'
    ];
    automationProps.forEach(prop => delete (window as any)[prop]);
    
    // Override webdriver detection completely
    Object.defineProperty(navigator, 'webdriver', { 
      get: () => undefined,
      configurable: true 
    });
    
    // Add realistic chrome runtime with full API
    (window as any).chrome = {
      runtime: {
        onConnect: undefined,
        onMessage: undefined,
        connect: function() { return { postMessage: function() {}, onMessage: { addListener: function() {} } }; },
        sendMessage: function() {},
        getURL: function(path: string) { return 'chrome-extension://fake/' + path; },
        getManifest: function() { return { version: '1.0.0' }; }
      },
      storage: {
        local: {
          get: function() { return Promise.resolve({}); },
          set: function() { return Promise.resolve(); }
        }
      }
    };
    
    // Override automation detection methods
    const originalEval = window.eval;
    window.eval = function(code: string) {
      if (code.includes('webdriver') || code.includes('automation')) {
        return false;
      }
      return originalEval.call(window, code);
    };
    
    // Override permissions API with full implementation
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: PermissionDescriptor): Promise<PermissionStatus> => {
      if (parameters.name === 'notifications') {
        return Promise.resolve({
          state: Notification.permission as PermissionState,
          name: 'notifications' as PermissionName,
          onchange: null,
          addEventListener: function() {},
          removeEventListener: function() {},
          dispatchEvent: function() { return false; }
        } as PermissionStatus);
      }
      return originalQuery.call(window.navigator.permissions, parameters);
    };
    
    // Add realistic plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => ({
        length: 3,
        0: { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
        1: { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
        2: { name: 'Native Client', filename: 'internal-nacl-plugin' }
      })
    });
    
    // Realistic screen properties
    Object.defineProperty(screen, 'availWidth', { get: () => screen.width });
    Object.defineProperty(screen, 'availHeight', { get: () => screen.height - 40 });
    
    // Randomize hardware concurrency
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => 8 // Use a common value
    });
    
    // Override toString methods to hide automation
    Function.prototype.toString = new Proxy(Function.prototype.toString, {
      apply: function(target, thisArg, argumentsList) {
        if (thisArg && thisArg.name && thisArg.name.includes('automation')) {
          return 'function() { [native code] }';
        }
        return target.apply(thisArg, argumentsList as []);
      }
    });
  });
  // Enhanced locale and timezone emulation
  const language = STEALTH_CONFIG.LANGUAGES[Math.floor(Math.random() * STEALTH_CONFIG.LANGUAGES.length)];
  const timezone = STEALTH_CONFIG.TIMEZONES[Math.floor(Math.random() * STEALTH_CONFIG.TIMEZONES.length)];
  
  await page.setExtraHTTPHeaders({ 
    'Accept-Language': `${language},en;q=0.9`,
    'User-Agent': ua // Ensure consistency
  });
  
  try {
    const client = await page.target().createCDPSession();
    await client.send('Emulation.setTimezoneOverride', { timezoneId: timezone });
    
    // Set realistic geolocation if not already set
    if (!process.env.SKIP_GEOLOCATION) {
      const coords = getRandomCoordinates(timezone);
      await client.send('Emulation.setGeolocationOverride', {
        latitude: coords.lat,
        longitude: coords.lng,
        accuracy: 30 + Math.random() * 70
      });
    }
  } catch {}
  
  // Align navigator properties with selected language
  try {
    await page.evaluateOnNewDocument((lang) => {
      Object.defineProperty(navigator, 'languages', { 
        get: () => [lang, 'en'] 
      });
      Object.defineProperty(navigator, 'language', { 
        get: () => lang 
      });
      
      // Add realistic connection info
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          effectiveType: '4g',
          rtt: 50 + Math.random() * 100,
          downlink: 5 + Math.random() * 10
        })
      });
    }, language);
  } catch {}

// Helper function to get realistic coordinates based on timezone (India-focused)
function getRandomCoordinates(timezone: string): { lat: number; lng: number } {
  const coords = {
    'Asia/Kolkata': { lat: 22.5726, lng: 88.3639 }, // Kolkata
    'Asia/Mumbai': { lat: 19.0760, lng: 72.8777 },  // Mumbai
    'Asia/Delhi': { lat: 28.7041, lng: 77.1025 },   // Delhi
    'Asia/Bangalore': { lat: 12.9716, lng: 77.5946 } // Bangalore
  };
  
  const base = coords[timezone as keyof typeof coords] || coords['Asia/Kolkata'];
  
  // Add some randomization to coordinates (smaller range for city-level accuracy)
  return {
    lat: base.lat + (Math.random() - 0.5) * 0.05, // ~5km variation
    lng: base.lng + (Math.random() - 0.5) * 0.05
  };
}

  const normalize = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // const normalizedBusiness = normalize(businessName);
  // Build significant tokens from the business name; avoid hardcoded stopwords.
  // Optional user-provided stopwords via env: GMB_STOPWORDS="word1,word2,word3"
  const userStops = (process.env.GMB_STOPWORDS || '')
    .toLowerCase()
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const userStopSet = new Set(userStops);
  const sigTokens = (businessName || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t && t.length >= 3 && !userStopSet.has(t));

  // Capture canonical RHS name from the expanded URL page as our primary target
  let targetName = '';
  try {
    try { await page.waitForSelector('[role="main"] h1, .DUwDvf, [data-attrid="title"]', { timeout: 8000 }); } catch {}
    targetName = await page.evaluate(() => (document.querySelector('[role="main"] h1, .DUwDvf, [data-attrid="title"]')?.textContent || '').trim());
  } catch {}
  // Compute a core prefix (before :, -, |, ( ) or similar separators)
  const extractCore = (s: string) => {
    const idx = s.search(/[:\-|()]/);
    const head = idx > 0 ? s.slice(0, idx) : s;
    return head.trim();
  };
  const corePrefix = extractCore(targetName || businessName || '').trim();
  const corePrefixNorm = normalize(corePrefix);

  // Will be used both during Local Finder selection and afterwards
  let topCompetitor: any = null;
  let competitorRank = -1;

  try {
    // Optionally set geolocation only if explicitly enabled (reduces automation signals by default)
    if (process.env.GMB_SET_GEO === 'true') {
      try {
        const client = await page.target().createCDPSession();
        let lat = 23.2599, lon = 77.4126; // Bhopal default
        if (city && city.toLowerCase().includes('bhopal')) { lat = 23.2599; lon = 77.4126; }
        await client.send('Emulation.setGeolocationOverride', { latitude: lat, longitude: lon, accuracy: 30 });
        const context = browser.defaultBrowserContext();
        try { await context.overridePermissions('https://www.google.co.in', ['geolocation']); } catch {}
      } catch {}
    }

    for (const kw of keywords) {
      let searchQuery = kw.query;
      searchQuery = searchQuery.replace(/^best\s+/i, '').trim();
      searchQuery = `Best ${searchQuery}`;
      if (!searchQuery.toLowerCase().includes(` in ${city.toLowerCase()}`)) {
        searchQuery = `${searchQuery} in ${city}`;
      }

      const keywordIndex = keywords.indexOf(kw);
      console.log(`\n🔍 Processing keyword ${keywordIndex + 1}/${keywords.length}: ${searchQuery}`);
      // Lightweight pacing only
      await randomDelay(200, 600);
      
      // Keep the same browser/page across keywords to match the first keyword behavior
      if (keywordIndex > 0) {
        // brief breathing delay to avoid rapid-fire queries
        await randomDelay(1200, 2500);
      }
      // Moderate human think-time before starting a new keyword search
      await randomDelay(2000, 5000);
      
      // Multiple CAPTCHA checks with different selectors
      const captchaSelectors = [
        'iframe[src*="recaptcha"]',
        'iframe[src*="captcha"]', 
        '#captcha',
        '.g-recaptcha',
        '.captcha',
        '[aria-label*="captcha" i]',
        '[aria-label*="verify" i]',
        'form[action*="sorry"]'
      ];
      
      for (const selector of captchaSelectors) {
        const hasCaptcha = await page.$(selector);
        if (hasCaptcha) {
          console.error('🚨 CAPTCHA detected! Stopping execution to avoid further detection.');
          console.error('Please wait 30+ minutes before running again, or use a different IP address.');
          await browser.close();
          process.exit(1);
        }
      }
      
      // Additional safety check - look for "unusual traffic" text
      const pageContent = await page.content();
      if (pageContent.includes('unusual traffic') || pageContent.includes('not a robot')) {
        console.warn('⚠️ Google flagged this session (unusual traffic). Attempting fallback and continuing...');
      }
      
      // Proceed with search
      let searchResults: any[] = [];
      // Direct URL search for every keyword to bypass soft-blocks (local results)
      let directUrl = `https://www.google.co.in/search?q=${encodeURIComponent(searchQuery)}&hl=en-IN&gl=IN&pws=0&ncr=1&num=10&tbm=lcl`;
      await safeGoto(page, directUrl);
      await acceptGoogleConsent(page);
      try { await (page as any).solveRecaptchas?.(); } catch {}
      // Attempt to handle captcha if presented
      try { await tryHandleCaptcha(page); } catch {}
      await randomDelay(300, 700);
      // If we still see the soft block message, try .com fallback
      try {
        const html = (await page.content()).toLowerCase();
        if (html.includes('having trouble accessing google search')) {
          directUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}&hl=en&gl=US&pws=0&ncr=1&num=10&tbm=lcl`;
          await safeGoto(page, directUrl);
          await acceptGoogleConsent(page);
          try { await (page as any).solveRecaptchas?.(); } catch {}
          try { await tryHandleCaptcha(page); } catch {}
          await randomDelay(300, 700);
        }
      } catch {}
      // Parse current page without extra navigation
      searchResults = await scrapeGoogleSearch(page, searchQuery, 20, { assumeResultsLoaded: true });

      // Old navigation-based path retained for reference (disabled)
      // searchResults = await scrapeGoogleSearch(page, searchQuery, 20);

      if (!searchResults || searchResults.length === 0) {
        console.warn('No search results found for:', kw.query);
        const result = {
          keyword: kw.keyword,
          yourRanking: 'N/A',
          topCompetitor: 'No competitor found',
          theirRank: 'N/A',
          competitorDetails: {
            rating: 'N/A',
            reviews: 'N/A',
            category: 'N/A',
            address: 'N/A',
            phone: 'N/A',
            website: 'N/A',
            mapsUrl: 'N/A',
            hours: 'N/A',
            about: 'N/A',
            services: [],
            description: 'N/A'
          },
          rating: 'N/A',
          reviews: 'N/A',
          category: 'N/A',
          address: 'N/A',
          phone: 'N/A',
          website: 'N/A',
          mapsUrl: 'N/A',
          lastUpdated: new Date().toISOString()
        };
        results.push(result);
        continue;
      }

      // prefer local pack / maps links if available
      const localPack = searchResults.filter((r: { url?: string }) => r.url && r.url.includes('google.com/maps'));
      const primarySource = localPack.length ? localPack : searchResults;

      let ourRank = -1;
      for (let i = 0; i < primarySource.length; i++) {
        const r = primarySource[i];
        const normTitle = normalize(r.title);
        const normUrl = (r.url || '').toLowerCase();
        // Be strict: only accept if the core business prefix is present in title or URL
        if (corePrefixNorm && corePrefixNorm.length >= 4 && ((normTitle && normTitle.includes(corePrefixNorm)) || (normUrl && normUrl.includes(corePrefixNorm)))) {
          ourRank = i + 1;
          break;
        }
      }

      // Fallback: open 'More places' (Local Finder) and search the entire list for our business
      if (ourRank === -1) {
        try {
          console.log('[Local Finder] Attempting to open full list via "More places"...');
          // Try to find and click the 'More places' link (without using $x)
          let clicked = false;
          const anchors = await page.$$('a');
          for (const a of anchors) {
            try {
              const info = await a.evaluate((el: Element) => ({
                text: (el.textContent || '').trim().toLowerCase(),
                aria: (el.getAttribute('aria-label') || '').toLowerCase(),
              }));
              if (info.text.includes('more places') || info.aria.startsWith('more places')) {
                await a.click();
                clicked = true;
                break;
              }
            } catch {}
          }
          if (!clicked) {
            // Try common button variants for More places
            const button = await page.$('a[aria-label^="More places"], a[href*="/maps?"], div[role="button"][jsaction][data-hveid]');
            if (button) { await button.click(); clicked = true; }
          }

          if (clicked) {
            // Some variants open the Local Finder in a NEW TAB/POPUP. Capture it if present.
            let lfPage: Page | null = null;
            try {
              const targetPromise = browser.waitForTarget(t => {
                try { return t.opener() === page.target() && /google\.[^/]+\/maps/i.test(t.url()); } catch { return false; }
              }, { timeout: 5000 });
              // Give the click a moment to spawn popup
              try { const target = await targetPromise; lfPage = target ? await target.page() : null; } catch {}
            } catch {}

            // If no popup, we assume same-tab navigation
            try { await (lfPage || page).waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }); } catch {}
            // Wait for Local Finder containers to appear
            try {
              await (lfPage || page).waitForSelector('div[role="feed"] [role="article"], a.hfpxzc, div[aria-label*="Results for"] [role="article"], .Nv2PK', { timeout: 15000 });
            } catch {}
            // Give list time to render more fully
            await randomDelay(2500, 4000);

            // Robust scan of Local Finder results for business rank
            let rankInFinder = -1;
            try {
              const scanRes = await scanLocalFinderForBusiness({
                page,
                lfPage,
                sigTokens,
                corePrefixNorm,
                maxScrolls: 20,
                scrollDelayMin: 1000,
                scrollDelayMax: 1700,
              });
              if (scanRes.foundIndex && scanRes.foundIndex > 0) {
                rankInFinder = scanRes.foundIndex;
                console.log(`[Local Finder] Found business at rank ${rankInFinder} — title: ${scanRes.foundTitle}`);
              } else {
                console.log('[Local Finder] Not found after scrolling attempts.');
              }
            } catch (e) {
              console.log('[Local Finder] Scan error:', e instanceof Error ? e.message : e);
            }
            if (rankInFinder && rankInFinder > 0) {
              ourRank = rankInFinder;
            }
            // Try to go back to the SERP to keep flow consistent
            try {
              if (lfPage && !lfPage.isClosed()) { await lfPage.close().catch(() => {}); }
              else { await page.goBack({ waitUntil: 'networkidle2' }); }
            } catch {}
          }
        } catch {}
      }

      // topCompetitor and competitorRank already declared above for Local Finder usage
      for (let i = 0; i < primarySource.length; i++) {
        const r = primarySource[i];
        const normTitle = normalize(r.title);
        const normUrl = (r.url || '').toLowerCase();
        // Skip if this looks like our business (corePrefixNorm in title/url)
        if (corePrefixNorm && ((normTitle && normTitle.includes(corePrefixNorm)) || (normUrl && normUrl.includes(corePrefixNorm)))) {
          continue;
        }
        topCompetitor = r;
        competitorRank = i + 1;
        break;
      }

      // Initialize default competitor details
      let competitorDetails: CompetitorDetails = {
        rating: 'N/A',
        reviews: 'N/A',
        category: 'N/A',
        address: 'N/A',
        phone: 'N/A',
        website: 'N/A',
        mapsUrl: 'N/A',
        hours: 'N/A',
        about: 'N/A',
        services: [],
        description: 'N/A',
        posts: '0',
        scheduleAvailable: false,
        callAvailable: false,
        hasDirections: false,
        reviewCount: '0',
        averageRating: '0.0',
        // Button availability flags (default to 'No')
        websiteBtn: 'No',
        scheduleBtn: 'No',
        callBtn: 'No'
      };

      if (topCompetitor) {
        // First, get basic details from the search result
        // Extract phone from snippet if present (fallback when Call button not available)
        let snippetPhone = '';
        try {
          const blob = `${topCompetitor.description || ''} ${topCompetitor.address || ''}`;
          const m = blob.match(/\+?\d[\d\s-]{7,}\d/);
          if (m) {
            snippetPhone = m[0].replace(/[^\d+]/g, '');
          }
        } catch {}

        competitorDetails = {
          ...competitorDetails,
          rating: topCompetitor.rating || 'N/A',
          reviews: topCompetitor.reviews || '0',
          category: topCompetitor.category || 'N/A',
          address: topCompetitor.address || 'N/A',
          website: topCompetitor.url && !topCompetitor.url.includes('google.com/maps') ? topCompetitor.url : 'N/A',
          mapsUrl: topCompetitor.url && topCompetitor.url.includes('google.com/maps') ? topCompetitor.url : 'N/A',
          phone: snippetPhone || 'N/A',
          callAvailable: !!snippetPhone || competitorDetails.callAvailable,
          callBtn: (snippetPhone ? 'Yes' : competitorDetails.callBtn)
        };

        // Open the first local result tile from the CURRENT results list (no new search)
        try {
          console.log('Opening first local result from current list...');

          // Ensure local results exist
          await page.waitForSelector('.rlfl__tls, .VkpGBb, .rllt__details, a[href*="/maps/place/"]', { timeout: 8000 }).catch(() => null);

          // Always start from the top of the page to guarantee we target the first result
          try { await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })); } catch {}
          await randomDelay(120, 240);

          // 1) Try to navigate directly to the first /maps/place link
          let firstPlaceHref = await page.evaluate(() => {
            const unwrap = (href: string): string => {
              try {
                if (!href) return href;
                const u = new URL(href, 'https://www.google.com');
                if (u.pathname === '/url') {
                  return u.searchParams.get('q') || u.searchParams.get('url') || href;
                }
                return href;
              } catch { return href; }
            };
            // Prefer FIRST container, then its FIRST place link
            const containers = Array.from(document.querySelectorAll('.rlfl__tls, .VkpGBb')) as HTMLElement[];
            if (containers.length) {
              const c0 = containers[0];
              const a0 = c0.querySelector('a[href*="/maps/place/"]') as HTMLAnchorElement | null;
              if (a0) return unwrap(a0.href);
              // Try title link inside first tile
              const t0 = c0.querySelector('a[role="link"], .dbg0pd a') as HTMLAnchorElement | null;
              if (t0 && /\/maps\/place\//.test(t0.href)) return unwrap(t0.href);
            }
            const a = document.querySelector('a[href*="/maps/place/"]') as HTMLAnchorElement | null;
            return a ? unwrap(a.href) : '';
          });

          if (firstPlaceHref) {
            await safeGoto(page, firstPlaceHref);
            await randomDelay(250, 600);
          } else {
            // 2) Deterministically click the FIRST title within the FIRST results container.
            const selOrder = [
              '.rlfl__tls .a4gq8e a[href*="/maps/place/"]',
              '.rlfl__tls .a4gq8e .qBF1Pd',
              '.VkpGBb .dbg0pd a[href*="/maps/"]',
              '.VkpGBb a[role="link"] h3'
            ];
            for (let attempt = 0; attempt < 3; attempt++) {
              for (const sel of selOrder) {
                try {
                  const exists = await page.$(sel);
                  if (!exists) continue;
                  await page.$eval(sel, (el: any) => el.scrollIntoView({ behavior: 'instant', block: 'start' }));
                  await page.click(sel, { delay: 20 });
                  // Wait either for navigation or RHS
                  try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 6000 }); } catch {}
                  const rhs = await page.$('#rhs');
                  const onMaps = /\/maps\//.test(page.url());
                  if (rhs || onMaps) throw new Error('DONE');
                } catch (e:any) {
                  if (String(e.message).includes('DONE')) break;
                }
              }
              const rhs = await page.$('#rhs');
              const onMaps = /\/maps\//.test(page.url());
              if (rhs || onMaps) break;
              // If attempt failed, try to fetch href and go directly
              const href2 = await page.evaluate(() => {
                const container = document.querySelector('.rlfl__tls') || document.querySelector('.VkpGBb');
                const firstTile = container ? (container as HTMLElement).querySelector('.a4gq8e, .VkpGBb, .rllt__details, [data-hveid]') : null;
                const a = firstTile ? firstTile.querySelector('a[href*="/maps/place/"]') as HTMLAnchorElement | null : null;
                return a?.href || '';
              });
              if (href2) {
                await page.goto(href2, { waitUntil: 'domcontentloaded', timeout: 20000 });
                break;
              }
              await randomDelay(200, 400);
            }

            // If we are still on SERP, last fallback: open a Google Maps Search by query
            const stillOnSerpAfter = !(await page.url()).includes('/maps/');
            if (stillOnSerpAfter) {
              const q = encodeURIComponent(`${topCompetitor.title} ${city}`);
              const mapsSearch = `https://www.google.com/maps/search/?api=1&query=${q}`;
              await safeGoto(page, mapsSearch);
              await randomDelay(400, 800);
            }
          }

          // If we accidentally landed on Directions, try to switch to the place details
          if (/\/maps\/dir\//i.test(page.url())) {
            try {
              const switched = await page.evaluate(() => {
                const clickIf = (sel: string) => {
                  const el = document.querySelector(sel) as HTMLElement | null;
                  if (el && typeof (el as any).click === 'function') { (el as any).click(); return true; }
                  return false;
                };
                if (clickIf('button:has-text("Details")')) return true;
                const a = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'))[0] as HTMLAnchorElement | undefined;
                if (a) { a.click(); return true; }
                return false;
              });
              if (switched) {
                try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 }); } catch {}
              }
            } catch {}
          }

          // Now scrape the place LHS
          const placeUrl = page.url();
          if (/google\.(com|co\.[a-z]+)\/maps\//i.test(placeUrl)) {
            const place = await scrapeMapsPlace(page, placeUrl);
            if (place) {
              competitorDetails = {
                ...competitorDetails,
                name: place.name || competitorDetails.name,
                rating: place.rating || place.averageRating || competitorDetails.rating || 'N/A',
                reviews: place.reviews || place.reviewCount || competitorDetails.reviews || '0',
                category: place.category || competitorDetails.category || 'N/A',
                address: place.address || competitorDetails.address || 'N/A',
                phone: place.phone || competitorDetails.phone || 'N/A',
                website: place.website || competitorDetails.website || 'N/A',
                mapsUrl: placeUrl,
                posts: place.posts || competitorDetails.posts || '0',
                scheduleAvailable: place.scheduleAvailable ?? competitorDetails.scheduleAvailable,
                callAvailable: place.callAvailable ?? competitorDetails.callAvailable,
                hasDirections: place.hasDirections ?? competitorDetails.hasDirections,
                websiteBtn: place.website ? 'Yes' : (competitorDetails.websiteBtn || 'No'),
                scheduleBtn: (place.scheduleAvailable ? 'Yes' : (competitorDetails.scheduleBtn || 'No')),
                callBtn: (place.callAvailable ? 'Yes' : (competitorDetails.callBtn || 'No')),
              } as any;
            }
          }

          // --- Old path (competitor search) kept for reference ---
          // [disabled]
          try {
            const mapsHref = await page.evaluate(() => {
              const unwrap = (href: string): string => {
                try {
                  if (!href) return href;
                  const u = new URL(href, 'https://www.google.com');
                  if (u.pathname === '/url') {
                    return u.searchParams.get('q') || u.searchParams.get('url') || href;
                  }
                  return href;
                } catch { return href; }
              };
              // Find first explicit Maps place link in local results or organic
              const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
              // Prefer /maps/place and avoid /maps/dir
              const cand = anchors.find(a => /google\.(com|co\.[a-z]+)\/maps\/place\//i.test(a.href));
              return cand ? unwrap(cand.href) : '';
            });
            if (mapsHref) {
              await safeGoto(page, mapsHref);
              await randomDelay(300, 700);
              // If we accidentally landed on Directions, try to switch to the place details
              if (/\/maps\/dir\//i.test(page.url())) {
                try {
                  const switched = await page.evaluate(() => {
                    const clickIf = (sel: string) => {
                      const el = document.querySelector(sel) as HTMLElement | null;
                      if (el && typeof (el as any).click === 'function') { (el as any).click(); return true; }
                      return false;
                    };
                    // Try clicking Details in directions panel
                    if (clickIf('button:has-text("Details")')) return true;
                    // Try first place link in the left panel
                    const a = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'))[0] as HTMLAnchorElement | undefined;
                    if (a) { a.click(); return true; }
                    return false;
                  });
                  if (switched) {
                    try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 }); } catch {}
                  } else {
                    // Last resort: transform /dir URL to /place if visible
                    const transformed = page.url().replace(/\/maps\/dir\//i, '/maps/place/');
                    if (/\/maps\/place\//i.test(transformed)) {
                      await safeGoto(page, transformed);
                      await randomDelay(200, 400);
                    }
                  }
                } catch {}
              }
              let place = await scrapeMapsPlace(page, mapsHref);
              // Post-fix: capture missing review count/avg rating from visible header if needed
              try {
                const headerStats = await page.evaluate(() => {
                  const out: any = {};
                  // Common containers around rating and review count
                  const scopes = [
                    document.querySelector('[role="main"]'),
                    document.body
                  ].filter(Boolean) as Element[];
                  for (const root of scopes) {
                    const text = (sel: string) => (root.querySelector(sel)?.textContent || '').trim();
                    // Try patterns like: 5.0 (251) or 4.7 (3k+)
                    const ratingText = text('span[aria-hidden="true"], .F7nice');
                    const combined = ratingText.match(/(\d+(?:\.\d+)?)\s*\(([^)]+)\)/);
                    if (combined) { out.averageRating = combined[1]; out.reviewCount = combined[2]; break; }
                    // Try aria-label on rating star icon
                    const star = root.querySelector('[aria-label*="stars" i], [aria-label*="rating" i]') as HTMLElement | null;
                    const al = (star?.getAttribute('aria-label') || '').trim();
                    const m = al.match(/(\d+(?:\.\d+)?)\s*stars?.*?\(([^)]+)\)/i) || al.match(/(\d+(?:\.\d+)?)(?:\s*stars?)?[^\d]*(\d[\d,]*\+?k?)/i);
                    if (m) { out.averageRating = m[1]; out.reviewCount = m[2]; break; }
                  }
                  return out;
                });
                if (headerStats) {
                  if ((!place?.reviewCount || place.reviewCount === '0' || place.reviewCount === 'N/A') && headerStats.reviewCount) {
                    place.reviewCount = headerStats.reviewCount;
                    place.reviews = headerStats.reviewCount;
                  }
                  if ((!place?.averageRating || place.averageRating === '0.0' || place.averageRating === 'N/A') && headerStats.averageRating) {
                    place.averageRating = headerStats.averageRating;
                    place.rating = headerStats.averageRating;
                  }
                }
              } catch {}
              if (place) {
                competitorDetails = {
                  ...competitorDetails,
                  name: place.name || competitorDetails.name,
                  rating: place.rating || place.averageRating || competitorDetails.rating || 'N/A',
                  reviews: place.reviews || place.reviewCount || competitorDetails.reviews || '0',
                  category: place.category || competitorDetails.category || 'N/A',
                  address: place.address || competitorDetails.address || 'N/A',
                  phone: place.phone || competitorDetails.phone || 'N/A',
                  website: place.website || competitorDetails.website || 'N/A',
                  mapsUrl: mapsHref,
                  posts: place.posts || competitorDetails.posts || '0',
                  scheduleAvailable: place.scheduleAvailable ?? competitorDetails.scheduleAvailable,
                  callAvailable: place.callAvailable ?? competitorDetails.callAvailable,
                  hasDirections: place.hasDirections ?? competitorDetails.hasDirections,
                  websiteBtn: place.website ? 'Yes' : (competitorDetails.websiteBtn || 'No'),
                  scheduleBtn: (place.scheduleAvailable ? 'Yes' : (competitorDetails.scheduleBtn || 'No')),
                  callBtn: (place.callAvailable ? 'Yes' : (competitorDetails.callBtn || 'No')),
                } as any;
              }
            } else {
              // Fallback: click the first local result PLACE link if available
              const clicked = await page.evaluate(() => {
                const link = document.querySelector('a[href*="/maps/place/"]') as HTMLAnchorElement | null;
                if (link) { link.click(); return true; }
                // Secondary: click a plausible card then place link
                const card = document.querySelector('[data-ludocid], [jscontroller*="lC9c2d"]') as HTMLElement | null;
                if (card && typeof (card as any).click === 'function') { (card as any).click(); return true; }
                return false;
              });
              if (clicked) {
                try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 }); } catch {}
                const href = page.url();
                if (/google\.com\/maps\//.test(href)) {
                  if (/\/maps\/dir\//i.test(href)) {
                    // Switch from directions to place view if possible
                    try {
                      await page.evaluate(() => {
                        const a = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'))[0] as HTMLAnchorElement | undefined;
                        if (a) (a as any).click();
                      });
                      try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 }); } catch {}
                    } catch {}
                  }
                  let place = await scrapeMapsPlace(page, href);
                  // Post-fix: capture missing review count/avg rating from visible header if needed
                  try {
                    const headerStats = await page.evaluate(() => {
                      const out: any = {};
                      const scopes = [document.querySelector('[role="main"]'), document.body].filter(Boolean) as Element[];
                      for (const root of scopes) {
                        const text = (sel: string) => (root.querySelector(sel)?.textContent || '').trim();
                        const ratingText = text('span[aria-hidden="true"], .F7nice');
                        const combined = ratingText.match(/(\d+(?:\.\d+)?)\s*\(([^)]+)\)/);
                        if (combined) { out.averageRating = combined[1]; out.reviewCount = combined[2]; break; }
                        const star = root.querySelector('[aria-label*="stars" i], [aria-label*="rating" i]') as HTMLElement | null;
                        const al = (star?.getAttribute('aria-label') || '').trim();
                        const m = al.match(/(\d+(?:\.\d+)?)\s*stars?.*?\(([^)]+)\)/i) || al.match(/(\d+(?:\.\d+)?)(?:\s*stars?)?[^\d]*(\d[\d,]*\+?k?)/i);
                        if (m) { out.averageRating = m[1]; out.reviewCount = m[2]; break; }
                      }
                      return out;
                    });
                    if (headerStats) {
                      if ((!place?.reviewCount || place.reviewCount === '0' || place.reviewCount === 'N/A') && headerStats.reviewCount) {
                        place.reviewCount = headerStats.reviewCount;
                        place.reviews = headerStats.reviewCount;
                      }
                      if ((!place?.averageRating || place.averageRating === '0.0' || place.averageRating === 'N/A') && headerStats.averageRating) {
                        place.averageRating = headerStats.averageRating;
                        place.rating = headerStats.averageRating;
                      }
                    }
                  } catch {}
                  if (place) {
                    competitorDetails = {
                      ...competitorDetails,
                      name: place.name || competitorDetails.name,
                      rating: place.rating || place.averageRating || competitorDetails.rating || 'N/A',
                      reviews: place.reviews || place.reviewCount || competitorDetails.reviews || '0',
                      category: place.category || competitorDetails.category || 'N/A',
                      address: place.address || competitorDetails.address || 'N/A',
                      phone: place.phone || competitorDetails.phone || 'N/A',
                      website: place.website || competitorDetails.website || 'N/A',
                      mapsUrl: href,
                      posts: place.posts || competitorDetails.posts || '0',
                      scheduleAvailable: place.scheduleAvailable ?? competitorDetails.scheduleAvailable,
                      callAvailable: place.callAvailable ?? competitorDetails.callAvailable,
                      hasDirections: place.hasDirections ?? competitorDetails.hasDirections,
                      websiteBtn: place.website ? 'Yes' : (competitorDetails.websiteBtn || 'No'),
                      scheduleBtn: (place.scheduleAvailable ? 'Yes' : (competitorDetails.scheduleBtn || 'No')),
                      callBtn: (place.callAvailable ? 'Yes' : (competitorDetails.callBtn || 'No')),
                    } as any;
                  }
                }
              }
            }
          } catch {}

          // First, scan the RHS panel globally for action chips (Website/Directions/Call/Book)
          try {
            const rhs = await page.evaluate(() => {
              const out: any = {};
              const unwrap = (href: string): string => {
                try {
                  if (!href) return href;
                  const u = new URL(href, 'https://www.google.com');
                  if (u.pathname === '/url') {
                    return u.searchParams.get('q') || u.searchParams.get('url') || href;
                  }
                  return href;
                } catch { return href; }
              };

              const spans = Array.from(document.querySelectorAll('span.PbOY2e')) as HTMLSpanElement[];
              const byLabel = (label: string) => spans.find(sp => (sp.textContent || '').trim().toLowerCase() === label);

              // Website
              const wSpan = byLabel('website');
              if (wSpan) {
                const a = wSpan.closest('a') as HTMLAnchorElement | null;
                let href = a?.getAttribute('href') || '';
                if (!href) {
                  const container = wSpan.closest('.n1obkb.mI8Pwc') as HTMLElement | null;
                  href = (container?.querySelector('a[href]') as HTMLAnchorElement | null)?.getAttribute('href') || '';
                }
                href = unwrap(href);
                if (href && !/google\./i.test(href)) {
                  out.website = href; out.websiteBtn = 'Yes';
                } else if (wSpan) {
                  out.websiteBtn = 'Yes';
                }
              }

              // Directions
              if (byLabel('directions')) out.hasDirections = true;

              // Call
              const cSpan = byLabel('call');
              if (cSpan) {
                const container = cSpan.closest('.n1obkb.mI8Pwc, .Od1FEc.n1obkb') as HTMLElement | null;
                const tel = container?.getAttribute('data-phone-number') || (container?.querySelector('a[href^="tel:"]') as HTMLAnchorElement | null)?.getAttribute('href') || '';
                out.callAvailable = true; out.callBtn = 'Yes';
                if (tel.startsWith('tel:')) out.phone = tel.replace('tel:', '');
                else if (/^\+?\d[\d\s-]+$/.test(tel)) out.phone = tel.trim();
              }

              // Book / Appointment
              const book = spans.find(sp => /\bbook\b|\bbook online\b|\bappointment\b/i.test((sp.textContent || '')));
              if (book) { out.scheduleAvailable = true; out.scheduleBtn = 'Yes'; }

              return out;
            });

            if (rhs) {
              if (rhs.website) { competitorDetails.website = rhs.website; }
              if (rhs.websiteBtn) { competitorDetails.websiteBtn = rhs.websiteBtn; }
              if (rhs.hasDirections) { competitorDetails.hasDirections = true; }
              if (rhs.callAvailable) { competitorDetails.callAvailable = true; competitorDetails.callBtn = 'Yes'; }
              if (rhs.phone && competitorDetails.phone === 'N/A') { competitorDetails.phone = rhs.phone; }
              if (rhs.scheduleAvailable) { competitorDetails.scheduleAvailable = true; competitorDetails.scheduleBtn = 'Yes'; }
            }
          } catch {}
          
          // Look for the knowledge panel or local pack result
          let businessCard = await page.$('div[data-attrid="kc:/location/location:business entity"]');
          if (!businessCard) {
            businessCard = await page.$('div[data-attrid="kc:/local:local result"]');
          }
          if (!businessCard) {
            const titleElement = await page.$('div[data-attrid="title"]');
            if (titleElement) {
              try {
                // Use evaluate to get the parent element
                const parentHandle = await page.evaluateHandle((el: HTMLElement) => {
                  return el.closest('div[data-attrid^="kc:/"]') || el.parentElement;
                }, titleElement);
                
                const element = await parentHandle.asElement();
                if (element) {
                  // Cast to any to avoid type issues with parent element
                  businessCard = element as unknown as ElementHandle<HTMLDivElement>;
                }
              } catch (error) {
                console.warn('Error getting parent element:', error);
              }
            }
          }
          
          if (businessCard) {
            // Extract rating if available
            const ratingEl = await businessCard.$('[aria-label*="stars"], [aria-label*="rating"]');
            if (ratingEl) {
              const ratingText = await ratingEl.evaluate((el: Element) => el.getAttribute('aria-label') || '');
              const ratingMatch = ratingText.match(/([0-9.]+)/);
              if (ratingMatch) {
                competitorDetails.rating = `Rated ${ratingMatch[1]} out of 5`;
                competitorDetails.averageRating = ratingMatch[1];
              }
              
              // Extract review count
              const reviewText = await ratingEl.evaluate((el: Element) => {
                const parent = el.parentElement as HTMLElement | null;
                return parent?.textContent || '';
              });
              // Support formats like 1K, 2.3K, 1,234
              const m1 = reviewText.match(/\(([^)]+)\)/); // try inside parens first
              const token = (m1?.[1] || reviewText || '').trim();
              let rev = 0;
              const mKM = token.match(/([0-9]+(?:\.[0-9]+)?)\s*([kKmM])/);
              if (mKM) {
                const n = parseFloat(mKM[1]);
                const mult = mKM[2].toLowerCase() === 'm' ? 1_000_000 : 1_000;
                rev = Math.round(n * mult);
              } else {
                const mNum = token.match(/([0-9][0-9,]*)/);
                if (mNum) rev = parseInt(mNum[1].replace(/,/g, ''), 10);
              }
              if (rev > 0) {
                competitorDetails.reviewCount = String(rev);
                competitorDetails.reviews = `${rev} reviews`;
              }
            }
            
            // Check for website - more comprehensive detection
            const websiteEl = await businessCard.$('a[href*="website"], a[href*=".com"], a[href*=".in"], a[href*=".org"], a[href*=".net"]');
            if (websiteEl) {
              const websiteUrl = await websiteEl.evaluate((el: Element) => {
                const anchor = el as HTMLAnchorElement;
                // Only return valid URLs
                try {
                  const url = new URL(anchor.href);
                  return url.href;
                } catch {
                  return '';
                }
              });
              competitorDetails.website = websiteUrl || 'N/A';
              // Mark Website button as present
              competitorDetails.websiteBtn = websiteUrl ? 'Yes' : 'No';
            } else {
              // Fallback: detect a visible Website button without href by checking text
              const hasWebsiteBtn = await businessCard.evaluate((root) => {
                const els = Array.from(root.querySelectorAll('button, a, [role="button"]')) as HTMLElement[];
                return els.some(el => (el.textContent || '').trim().toLowerCase().includes('website'));
              });
              if (hasWebsiteBtn) {
                competitorDetails.websiteBtn = 'Yes';
              }
            }
            
            // Check for posts in the business profile
            try {
              const postsElement = await businessCard.$('[data-attrid*="kc:/local:post"]');
              if (postsElement) {
                const postsText = await postsElement.evaluate(el => el.textContent || '');
                const postsMatch = postsText.match(/(\d+)/);
                if (postsMatch) {
                  competitorDetails.posts = postsMatch[1];
                }
              }
            } catch (error) {
              console.warn('Error checking for posts:', error);
            }
            
            // Check for call button - more comprehensive detection
            const callButton = await businessCard.$([
              'a[href^="tel:"]',
              '[aria-label*="call" i]',
              '[aria-label*="phone" i]',
              '[data-tooltip*="call" i]',
              '[data-tooltip*="phone" i]'
            ].join(','));
            
            if (callButton) {
              competitorDetails.callAvailable = true;
              competitorDetails.phone = await callButton.evaluate((el: Element) => {
                // Clean up phone number
                const phoneText = el.textContent?.trim() || '';
                return phoneText.replace(/[^\d+]/g, '') || 'N/A';
              });
              // Mark Call button as present
              competitorDetails.callBtn = 'Yes';
            } else {
              // Fallback: detect a visible Call button without attributes by checking text
              const hasCallBtn = await businessCard.evaluate((root) => {
                const els = Array.from(root.querySelectorAll('button, a, [role="button"]')) as HTMLElement[];
                return els.some(el => (el.textContent || '').trim().toLowerCase().includes('call'));
              });
              if (hasCallBtn) {
                competitorDetails.callAvailable = true;
                competitorDetails.callBtn = 'Yes';
              }
            }
            
            // Check for schedule button - more comprehensive detection
            const scheduleButton = await businessCard.$([
              'button[aria-label*="schedule" i]',
              'button[aria-label*="appointment" i]',
              'button[aria-label*="booking" i]',
              '[data-tooltip*="schedule" i]',
              '[data-tooltip*="appointment" i]',
              'a[href*="booking" i]',
              'a[href*="appointment" i]'
            ].join(','));
            
            if (scheduleButton) {
              competitorDetails.scheduleAvailable = true;
              // Mark Schedule button as present
              competitorDetails.scheduleBtn = 'Yes';
            } else {
              // Fallback: detect by visible text variants
              const hasScheduleBtn = await businessCard.evaluate((root) => {
                const textHas = (s: string) => (s || '').toLowerCase();
                const els = Array.from(root.querySelectorAll('button, a, [role="button"]')) as HTMLElement[];
                return els.some(el => {
                  const t = textHas(el.textContent || '');
                  return t.includes('schedule') || t.includes('appointment') || t.includes('book') || t.includes('reserve');
                });
              });
              if (hasScheduleBtn) {
                competitorDetails.scheduleAvailable = true;
                competitorDetails.scheduleBtn = 'Yes';
              }
            }
            
            // Attempt to open Photos overlay and count tiles (posts proxy)
            try {
              // 1) Try aria-label based quick click on SERP RHS
              let clickedPhotos = false;
              const ariaPhotos = await page.$('[aria-label^="See photos" i], [aria-label*="See photos" i], a[aria-label*="Photos" i], [role="button"][aria-label*="Photos" i]');
              if (ariaPhotos) { await ariaPhotos.click(); clickedPhotos = true; }
              // 1b) If not, try text-based candidates
              if (!clickedPhotos) {
                const candidates = await page.$$('a, button, [role="button"]');
                for (const h of candidates) {
                  try {
                    const txt = (await h.evaluate(el => (el.textContent || '').trim().toLowerCase())) || '';
                    if (txt.includes('see photos') || txt === 'photos' || txt.includes('photos')) {
                      await h.click();
                      clickedPhotos = true;
                      break;
                    }
                  } catch {}
                }
              }
              if (clickedPhotos) {
                try { await page.waitForSelector('div[role="dialog"], div[aria-label*="Photos" i]', { timeout: 8000 }); } catch {}
                // Count photo tiles by scrolling the overlay container
                const total = await page.evaluate(async () => {
                  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
                  // Common overlay scroll container
                  const overlay = (document.querySelector('div[role="dialog"] .U26fgb, div[role="dialog"] .OFaVn, div[role="dialog"] .nIWXKc') as HTMLElement)
                    || (document.querySelector('div[role="dialog"]') as HTMLElement)
                    || document.body;
                  let prev = 0;
                  for (let i = 0; i < 6; i++) {
                    try { overlay.scrollBy(0, Math.max(overlay.clientHeight, 600)); } catch {}
                    await sleep(600);
                    const tiles = Array.from(document.querySelectorAll('div[role="dialog"] [role="gridcell"], div[role="dialog"] a[role="link"], div[role="dialog"] img'));
                    if (tiles.length <= prev) break;
                    prev = tiles.length;
                  }
                  const tiles = Array.from(document.querySelectorAll('div[role="dialog"] [role="gridcell"], div[role="dialog"] a[role="link"], div[role="dialog"] img'));
                  return tiles.length;
                });
                if (Number.isFinite(total) && total > 0) {
                  competitorDetails.posts = String(total);
                }
                // Close overlay
                try {
                  const closeBtn = await page.$('div[role="dialog"] [aria-label="Close" i], div[role="dialog"] button[aria-label*="Close" i]');
                  if (closeBtn) await closeBtn.click(); else await page.keyboard.press('Escape');
                } catch {}
                await randomDelay(300, 700);
              }
              // 2) Fallback: open Maps place URL and navigate to Photos grid
              if (!clickedPhotos && (competitorDetails.mapsUrl && competitorDetails.mapsUrl !== 'N/A')) {
                try {
                  await safeGoto(page, competitorDetails.mapsUrl);
                  try { await page.waitForSelector('.m6QEr, [role="main"]', { timeout: 12000 }); } catch {}
                  // Try clicking Photos tab/button
                  let clicked = false;
                  const photosBtn = await page.$('a[aria-label*="Photos" i], button[aria-label*="Photos" i], [role="link"][aria-label*="Photos" i]');
                  if (photosBtn) { await photosBtn.click(); clicked = true; }
                  if (!clicked) {
                    const chips = await page.$$('a, button, [role="button"]');
                    for (const c of chips) {
                      try {
                        const t = (await c.evaluate(el => (el.textContent || '').trim().toLowerCase())) || '';
                        if (t.includes('photos')) { await c.click(); clicked = true; break; }
                      } catch {}
                    }
                  }
                  if (clicked) {
                    try { await page.waitForSelector('[role="grid"], [role="main"] img', { timeout: 8000 }); } catch {}
                    const total2 = await page.evaluate(async () => {
                      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
                      const scrollArea = (document.querySelector('.m6QEr[aria-label], .DxyBCb .m6QEr') as HTMLElement) || document.body;
                      let prev = 0;
                      for (let i = 0; i < 8; i++) {
                        try { scrollArea.scrollBy(0, Math.max(scrollArea.clientHeight, 700)); } catch {}
                        await sleep(500);
                        const tiles = Array.from(document.querySelectorAll('[role="gridcell"], a[role="link"], img[src]'));
                        if (tiles.length <= prev) break;
                        prev = tiles.length;
                      }
                      const tiles = Array.from(document.querySelectorAll('[role="gridcell"], a[role="link"], img[src]'));
                      return tiles.length;
                    });
                    if (Number.isFinite(total2) && total2 > 0) {
                      competitorDetails.posts = String(total2);
                    }
                  }
                } catch {}
              }
            } catch {}
            
            // Extract address
            const addressEl = await businessCard.$('[data-tooltip*="address"], [aria-label*="address"]');
            if (addressEl) {
              competitorDetails.address = await addressEl.evaluate((el: Element) => el.textContent?.trim() || 'N/A');
              competitorDetails.hasDirections = true;
            }
          }
        } catch (error) {
          console.warn('Error performing detailed search for competitor:', error);
        }
      }

      // If we have a maps URL, enrich it by opening maps and scraping
      if (topCompetitor?.url?.includes('google.com/maps')) {
        try {
          console.log(`Enriching with maps details for: ${topCompetitor.title}`);
          await randomDelay(1000, 2000);
          const details = await scrapeMapsPlace(page, topCompetitor.url);
          if (details) {
            // Only update fields that aren't already set from the detailed search
            competitorDetails = {
              ...competitorDetails,
              ...Object.fromEntries(
                Object.entries(details).filter(([_, v]) => v && v !== 'N/A' && v !== '0' && v !== 0 && v !== false)
              ),
              // Preserve the original URL and any other important fields
              mapsUrl: competitorDetails.mapsUrl || topCompetitor.url,
              website: competitorDetails.website || details.website || 'N/A'
            };
          }
        } catch (e) {
          console.warn('Failed to enrich maps details:', (e as Error).message);
        }
      }

      const resultRow: RankingRow = {
        keyword: kw.keyword,
        yourRanking: ourRank > 0 ? String(ourRank) : 'Not Ranked in Top 20',
        topCompetitor: topCompetitor?.title || 'N/A',
        theirRank: topCompetitor ? String(competitorRank) : 'N/A',
        competitorDetails,
        rating: competitorDetails.rating,
        reviews: competitorDetails.reviews,
        category: competitorDetails.category,
        address: competitorDetails.address,
        phone: competitorDetails.phone,
        website: competitorDetails.website,
        mapsUrl: competitorDetails.mapsUrl,
        lastUpdated: new Date().toISOString()
      };

      // console.log(`Processed keyword: ${kw.keyword}`);
      // console.log(JSON.stringify(resultRow, null, 2));
      results.push(resultRow);

      // Intelligent pacing between keywords (increased)
      await sessionManager.paceRequest();
      await randomDelay(60000, 120000);
    }
  } finally {
    await browser.close();
  }

// ... (rest of the code remains the same)
  return results;
}

function printTable(rows: RankingRow[]) {
  console.log('\nCurrent Keyword Rankings\n');
  console.table(
    rows.map(r => ({
      Keyword: r.keyword,
      'My Rank': r.yourRanking,
      Competitor: r.topCompetitor,
      'Competitor Rank': r.theirRank
    }))
  );
  // console.log('\nJSON Result:\n', JSON.stringify(rows, null, 2));
}

function printCompetitorTable(rows: RankingRow[]) {
  console.log('\nCompetitor Analysis Table\n');
  
  // Get unique competitors by name to avoid duplicates
  const competitors = new Map<string, {name: string, details: CompetitorDetails}>();
  
  rows.forEach(row => {
    if (row.competitorDetails) {
      // Use business name as the primary identifier
      const cleanName = row.topCompetitor.split('|')[0].trim();
      
      // If we have a mapsUrl, use it as part of the key to handle different locations with same name
      const identifier = row.competitorDetails.mapsUrl && row.competitorDetails.mapsUrl !== 'N/A' 
        ? `${cleanName}::${row.competitorDetails.mapsUrl}` 
        : cleanName;
      
      // Set hasDirections based on address
      const hasMapIt = (row.competitorDetails.address || '').toLowerCase().includes('map it');
      row.competitorDetails.hasDirections = hasMapIt || (!!row.competitorDetails.address && row.competitorDetails.address !== 'Map it');
      
      // Extract review count from category if available
      const category = row.competitorDetails.category || '';
      const reviewMatch = category.match(/\((\d+)\)/);
      if (reviewMatch && reviewMatch[1]) {
        row.competitorDetails.reviewCount = reviewMatch[1];
      }
      
      if (!competitors.has(identifier)) {
        competitors.set(identifier, {
          name: cleanName,
          details: row.competitorDetails
        });
      }
    }
  });

  // Create table data with cleaner formatting
  const tableData = Array.from(competitors.values()).map(({name, details}) => {
    // Ensure button detection fields exist
    if (!details.websiteBtn) details.websiteBtn = 'No';
    if (!details.scheduleBtn) details.scheduleBtn = 'No';
    if (!details.callBtn) details.callBtn = 'No';
    // Clean up the rating
    let rating = 'N/A';
    const ratingMatch = (details.rating || '').match(/([0-9.]+)/);
    if (ratingMatch) {
      rating = parseFloat(ratingMatch[1]).toFixed(1);
    }
    
    // Get review count - support K/M and comma numbers
    const toCount = (s?: string) => {
      const v = (s || '').trim();
      const km = v.match(/^([0-9]+(?:\.[0-9]+)?)\s*([kKmM])$/);
      if (km) {
        const n = parseFloat(km[1]);
        return String(Math.round(n * (km[2].toLowerCase() === 'm' ? 1_000_000 : 1_000)));
      }
      const num = v.match(/[0-9][0-9,]*/);
      if (num) return num[0].replace(/,/g, '');
      return '0';
    };
    let reviews = '0';
    if (details.reviewCount) {
      reviews = toCount(details.reviewCount);
    } else {
      const paren = (details.category || '').match(/\(([^)]+)\)/)?.[1];
      reviews = toCount(paren);
    }
    
    // Clean up address - handle 'Map it' case
    let address = (details.address || '').replace(/\n/g, ', ').replace(/\s+/g, ' ').trim();
    if (address.toLowerCase() === 'map it') {
      address = 'Map available';
    }
    
    // Clean up category - remove rating and other metadata
    let category = (details.category || '').split('·')[0].trim();
    category = category.replace(/\d+\.?\d*\s*★?\s*\(\d+\)/, '').trim();
    
    // Determine if directions are available
    const hasDirections = details.hasDirections || (details.address && details.address.toLowerCase().includes('map it'));
    
    // Button flags renamed for display
    const websiteBtn = details.websiteBtn || 'No';
    const scheduleBtn = details.scheduleBtn || 'No';
    const callBtn = details.callBtn || 'No';
    
    return {
      'Competitor': name,
      'Rating': rating,
      'Reviews': reviews,
      'Website': websiteBtn,
      'Scehule': scheduleBtn,
      'Call': callBtn,
      'Directions': hasDirections ? 'Yes' : 'No',
      'Phone': details.phone && details.phone !== 'N/A' ? details.phone : 'N/A',
      'Category': category || 'N/A',
      'Address': address.substring(0, 30) + (address.length > 30 ? '...' : '')
    };
  });

  // Sort by number of reviews (descending)
  tableData.sort((a, b) => {
    const aReviews = parseInt(a['Reviews'] || '0');
    const bReviews = parseInt(b['Reviews'] || '0');
    return bReviews - aReviews;
  });

  // Display only the most important columns in the table
  const displayColumns = [
    'Competitor', 
    'Rating', 
    'Reviews', 
    'Website',
    'Scehule',
    'Call',
    'Directions',
    'Phone'
  ];
  const filteredTableData = tableData.map(entry => {
    const filtered: Record<string, any> = {};
    displayColumns.forEach(col => {
      filtered[col] = entry[col as keyof typeof entry];
    });
    return filtered;
  });

  console.table(filteredTableData);
  
  // Detailed view for each competitor
  // console.log('\nDetailed Competitor Information:\n');
  // tableData.forEach((competitor, index) => {
  //   console.log(`\n${index + 1}. ${competitor.Competitor}`);
  //   console.log('─'.repeat(competitor.Competitor.length + 4));
  //   console.log(`⭐ Rating: ${competitor.Rating} (${competitor.Reviews} reviews)`);
  //   console.log(`📱 Phone: ${competitor.Phone || '❌ Not Available'}`);
  //   console.log(`🌐 Website: ${competitor.Website === 'Yes' ? '✅ Available' : '❌ Not Available'}`);
  //   console.log(`📅 Schedule: ${competitor.Scehule === 'Yes' ? '✅ Available' : '❌ Not Available'}`);
  //   console.log(`📞 Call: ${competitor.Call === 'Yes' ? '✅ Available' : '❌ Not Available'}`);
  //   console.log(`🧭 Directions: ${competitor.Directions === 'Yes' ? '✅ Available' : '❌ Not Available'}`);
  //   console.log(`📝 Posts: ${competitor.Posts || '0'}`);
  //   console.log(`📍 Address: ${competitor.Address || 'Not available'}`);
  //   console.log(`🏷️  Category: ${competitor.Category || 'N/A'}`);
  // });
}

async function main() {
  const args = parseArgs();
  if (!args.gmbUrl) {
    console.error('Usage: node gmbrankingscrapping.ts --gmbUrl="https://maps.app.goo.gl/..."');
    process.exit(1);
  }

  console.log('Starting GMB Scraper (stealth mode)...');
  console.log('GMB URL:', args.gmbUrl);

  const { business, city, keywords, expandedUrl } = await generateKeywordIdeas(args.gmbUrl);

  if (!business || !keywords || keywords.length === 0) {
    console.error('Missing business or keywords — aborting.');
    process.exit(1);
  }

  console.log(`Business: ${business}`);
  console.log(`City: ${city}`);
  console.log('Keywords:');
  keywords.forEach((k, i) => console.log(`  ${i + 1}. ${k.keyword} -> ${k.query}`));

  // Fetch and display my business details directly from Maps expanded URL (LHS panel)
  const myDetails = await fetchMyBusinessDetailsFromGoogle(business, city, expandedUrl);

  console.log('\nGenerating rankings...');
  const rankings = await generateScrapedRankings(keywords, business, city);
  
  // Print the main rankings table
  printTable(rankings);
  
  // Print the detailed competitor analysis table
  if (rankings.length > 0) {
    printCompetitorTable(rankings);
  }

  // Build GMB report prompt and generate report via Gemini
  const detailsForPrompt = myDetails || {
    name: business,
    averageRating: 'N/A',
    reviewCount: '0',
    category: '',
    address: '',
    phone: '',
    website: '',
    websiteBtn: 'No',
    scheduleAvailable: false,
    callAvailable: false,
    hasDirections: false,
    posts: '0'
  } as MyBizDetails;

  try {
    // Preferred: build our own styled HTML to match the required format (header + snapshot + two tables)
    let narrativeHtml: string | undefined;
    try {
      const nPrompt = buildNarrativePrompt(detailsForPrompt, rankings, city);
      narrativeHtml = String(await getAiGeneratedText(nPrompt) || '').trim();
    } catch {}
    const styledHtml = buildStyledHtmlReport(detailsForPrompt, rankings, city, narrativeHtml);
    await saveHtmlAndMaybePdf(styledHtml, detailsForPrompt.name || business, Boolean(args.pdf));
    // Optional: enable AI-generated HTML via env flag USE_AI_PROMPT=1
    if (process.env.USE_AI_PROMPT === '1') {
      const prompt = buildGmbReportPrompt(detailsForPrompt, rankings);
      const html = await getAiGeneratedText(prompt);
      await saveHtmlAndMaybePdf(String(html || ''), `${detailsForPrompt.name || business}_AI`, Boolean(args.pdf));
    }
  } catch (e) {
    console.warn('Failed to generate/save GMB report:', (e as Error).message);
  }

  // Save to file if needed
  // fs.writeFileSync('rankings.json', JSON.stringify(rankings, null, 2));
  // console.log('\nResults saved to rankings.json');
}

main().catch(e => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
