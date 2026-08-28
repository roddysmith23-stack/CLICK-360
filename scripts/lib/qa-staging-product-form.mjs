/**
 * Drive the real product form through visible Playwright locators.
 * This helper does not know credentials, Firebase paths, or customer data.
 */
export async function submitSyntheticProduct(page, product) {
  await page.evaluate(() => window.click360Route('inventory'));

  const expected = {
    pCode: product.code,
    pName: product.name,
    pQty: String(product.stock),
    pCost: String(product.cost ?? 4),
    pPrice: String(product.price ?? 9),
    pCardPrice: String(product.cardPrice ?? 9.5)
  };
  const deadline = Date.now() + 30_000;
  let lastError = null;

  // A remote snapshot may re-render Inventory while the modal is open. Reacquire
  // the visible controls and retry the whole form instead of keeping stale nodes.
  while (Date.now() < deadline) {
    try {
      const form = page.locator('#productForm:visible');
      if (await form.count() === 0) {
        const trigger = product.id
          ? page.locator(`[data-edit="${product.id}"]:visible`).first()
          : page.locator('#newProduct:visible');
        await trigger.waitFor({ state: 'visible', timeout: 5_000 });
        await trigger.click();
        await form.waitFor({ state: 'visible', timeout: 5_000 });
      }

      for (const [id, value] of Object.entries(expected)) {
        const input = form.locator(`#${id}`);
        await input.fill(value, { timeout: 5_000 });
      }

      const valuesMatch = await form.evaluate((node, values) => Object.entries(values)
        .every(([id, value]) => node.querySelector(`#${id}`)?.value === value), expected);
      if (!valuesMatch) throw new Error('product_form_values_replaced_before_submit');

      await page.evaluate(() => {
        window.__CLICK360_QA_PREVIOUS_CONFIRMATION = window.CLICK360_LAST_CONFIRMATION_DIAGNOSTICS || null;
      });
      await form.locator('button[type="submit"]').click({ timeout: 5_000 });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw new Error(`product_form_not_stable_before_deadline: ${lastError.message}`);
  }

  await page.waitForFunction(() => {
    const diagnostics = window.CLICK360_LAST_CONFIRMATION_DIAGNOSTICS || null;
    const message = document.getElementById('toast')?.textContent || '';
    const isNewTerminalAttempt = diagnostics
      && diagnostics !== window.__CLICK360_QA_PREVIOUS_CONFIRMATION
      && diagnostics.outcome
      && diagnostics.outcome !== 'pending';
    return isNewTerminalAttempt && (
      /confirmado en la nube/.test(message)
        || /no fue confirmado/.test(message)
        || /conflicto/.test(message)
        || /procesando/.test(message)
    );
  }, { timeout: 45_000 });

  return page.evaluate((code) => {
    const candidate = window.click360GetTenantState?.().products?.find((item) => item.code === code) || null;
    return {
      ok: true,
      productId: candidate?.id || null,
      stock: Number(candidate?.stock ?? candidate?.qty ?? NaN),
      toastMessage: document.getElementById('toast')?.textContent || '',
      message: document.getElementById('toast')?.textContent || '',
      diagnostics: window.CLICK360_LAST_CONFIRMATION_DIAGNOSTICS || null
    };
  }, product.code);
}
