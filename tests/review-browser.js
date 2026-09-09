// CI smoke test. Build examples/review-demo.data.json as atlas-review.html first.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');

async function main() {
    const directory = path.resolve(process.argv[2] || 'work/browser-smoke');
    const html = await fs.readFile(path.join(directory, 'atlas-review.html'));
    const fixtures = new Map([['/atlas-review.html',html]]);
    for(const kind of ['historical','empty'])fixtures.set(`/atlas-${kind}.html`,await fs.readFile(path.join(directory,`atlas-${kind}.html`)));
    const server = http.createServer((request, response) => {
        response.writeHead(fixtures.has(request.url) ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(fixtures.get(request.url) || 'Not found');
    });
    let browser;
    try {
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        browser = await chromium.launch();
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
        page.setDefaultTimeout(10000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(()=>{
            window.drawnPositions={};const original=CanvasRenderingContext2D.prototype.fillText;
            CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){window.drawnPositions[text]=[x,y];return original.call(this,text,x,y,...rest);};
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/atlas-review.html`);
        await expect(page.locator('.stage .legend,.stage .hint')).toHaveCount(0);
        for(let i=0;i<5;i++)await page.locator('#zin').click();
        // Wait for the canvas to render the final zoom before comparing scopes.
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        await expect.poll(()=>page.evaluate(()=>window.drawnPositions.PAYMENTS||window.drawnPositions.K4)).toBeTruthy();
        const label=await page.evaluate(()=>window.drawnPositions.PAYMENTS?'PAYMENTS':'K4');
        const before=await page.evaluate(label=>window.drawnPositions[label],label);
        await page.locator('#review-scope').selectOption('whole');
        await page.screenshot({path:path.join(directory,'stable-whole.png')});
        assert.deepEqual(await page.evaluate(label=>window.drawnPositions[label],label),before,'Scope switch must preserve component screen coordinates');
        await page.locator('#review-scope').selectOption('changes');
        await expect(page.locator('#review-scope')).toHaveValue('changes');
        await expect(page.locator('#pbody')).toContainText(/fictional/i);
        await expect(page.locator('#pbody .review-summary')).toContainText('4 changed files');
        const scopedCount = await page.locator('#rail .item:visible').count();
        await page.locator('#review-scope').selectOption('whole');
        await expect.poll(() => page.locator('#rail .item:visible').count()).toBeGreaterThan(scopedCount);
        await page.locator('#review-scope').selectOption('changes');
        await expect(page.locator('#rail .item:visible')).toHaveCount(scopedCount);
        const context = page.locator('#review-context');
        await context.check();
        await expect(context).toBeChecked();
        await context.uncheck();
        await expect(context).not.toBeChecked();
        await page.locator('#collapse-groups').click();
        await expect(page.locator('#rail .group-toggle[aria-expanded="true"]')).toHaveCount(0);
        await page.locator('#expand-groups').click();
        await expect(page.locator('#rail .group-toggle[aria-expanded="true"]')).not.toHaveCount(0);
        await page.locator('#layout-mode').selectOption('auto');
        await expect(page.locator('#layout-mode')).toHaveValue('auto');
        await page.locator('#layout-mode').selectOption('authored');
        await expect(page.locator('#layout-mode')).toHaveValue('authored');
        await page.locator('[data-review-node="payments"]').first().click();
        await expect(page.locator('#pbody')).toContainText(/modified/i);
        await page.screenshot({ path: path.join(directory, 'review-studio.png') });
        await page.goto(`http://127.0.0.1:${server.address().port}/atlas-historical.html`);
        await page.locator('[data-review-node="retired"]').click();
        await expect(page.locator('#pbody')).toContainText('Historical component');
        await expect(page.locator('#pbody')).toContainText('legacy/service.js');
        await expect(page.locator('#stats')).toContainText('22,610');
        await page.goto(`http://127.0.0.1:${server.address().port}/atlas-empty.html`);
        await expect(page.locator('#view-empty')).toBeVisible();
        await page.locator('#review-scope').selectOption('whole');
        await expect(page.locator('#rail .item:visible')).toHaveCount(26);
        assert.deepEqual(errors, [], 'Review view must have no browser errors');
        console.log('PASS PR review: scope, context, groups, layout, component details and fictional provenance');
    } finally {
        if (browser) await browser.close();
        server.closeAllConnections();
        if (server.listening) await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
