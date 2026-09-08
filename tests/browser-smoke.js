// Run after building atlas-foundry.html and atlas-drafting.html into the given directory.
// Usage: node tests/browser-smoke.js [build-directory]
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');

async function main() {
  const directory = path.resolve(process.argv[2] || 'work/browser-smoke');
  const pages = new Map();
  for (const theme of ['studio', 'foundry', 'drafting']) {
    pages.set(`/atlas-${theme}.html`, await fs.readFile(path.join(directory, `atlas-${theme}.html`)));
  }
  // Serve only these two known artifacts, with an OS-assigned port and no subprocess.
  const server = http.createServer((request, response) => {
    const page = pages.get(request.url);
    response.writeHead(page ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(page || 'Not found');
  });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    browser = await chromium.launch();
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const theme of ['studio', 'foundry', 'drafting']) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        // Observe the canvas's public drawing API to verify repeated-visit badges.
        await page.addInitScript(() => {
          window.drawnLabels = new Set();
          const fillText = CanvasRenderingContext2D.prototype.fillText;
          CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
            window.drawnLabels.add(String(text));
            return fillText.call(this, text, ...args);
          };
        });
        await page.goto(`${origin}/atlas-${theme}.html`);
        await expect(page.locator('#journey-select option')).toHaveCount(3);
        await expect(page.locator('#pbody')).toContainText('Fictional example');
        await expect(page.locator('#stats')).toContainText('22,610');
        for (const id of ['toggle-icons', 'toggle-aws']) {
          const toggle = page.locator(`#${id}`);
          await expect(toggle).toHaveAttribute('aria-pressed', 'false');
          await toggle.click();
          await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        }

        await page.locator('#journey-select').selectOption('retry');
        await expect(page.locator('#step-position')).toHaveText('Not started');
        await page.locator('#btn-step').click();
        await expect(page.locator('#step-position')).toHaveText('1 / 5');
        await expect(page.locator('#pbody [data-visit]')).toHaveText(['STEP 1', 'STEP 3']);
        await page.locator('#pbody [data-visit="2"]').click();
        await expect(page.locator('#step-position')).toHaveText('3 / 5');
        await expect.poll(() => page.evaluate(() => window.drawnLabels.has('1,3'))).toBe(true);
        await page.locator('#btn-step').click();
        await expect(page.locator('#step-position')).toHaveText('4 / 5');
        await expect.poll(() => page.evaluate(() => window.drawnLabels.has('2,4'))).toBe(true);
        await page.locator('#btn-prev').click();
        await expect(page.locator('#step-position')).toHaveText('3 / 5');
        await page.screenshot({ path: path.join(directory, `retry-${theme}.png`) });

        await page.locator('#journey-select').selectOption('notification');
        await expect(page.locator('#step-position')).toHaveText('Not started');
        for (let step = 1; step <= 3; step++) {
          await page.locator('#btn-step').click();
          await expect(page.locator('#step-position')).toHaveText(`${step} / 3`);
        }
        await page.locator('[data-tab="how"]').click();
        await expect(page.locator('#pbody')).toContainText('Fictional example');
        await expect(page.locator('#pbody .file')).not.toHaveCount(0);
        await expect(page.locator('#pbody .file a')).toHaveCount(0);
        assert.deepEqual(errors, [], `${theme} has browser errors`);
        console.log(`PASS ${theme}: metrics, provenance, icon toggles, alternate journeys, repeat visits and source panel`);
      } finally {
        await page.close();
      }
    }
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      server.closeAllConnections();
      if (server.listening) await new Promise(resolve => server.close(resolve));
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
