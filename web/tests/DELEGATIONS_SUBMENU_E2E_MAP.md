# Delegations Sub-Menu E2E Impact Map

## Context
The Delegations UI is now split into sub-views:
- `Received`
- `Created`
- `Identity`

New stable selectors:
- `data-testid="delegations-subtab-received"`
- `data-testid="delegations-subtab-created"`
- `data-testid="delegations-subtab-identity"`

Backward compatibility is currently preserved for core selectors (`create-did-button`, `toggle-import-form-button`, `import-delegation-textarea`, headings), so existing tests should keep working.

## Files To Update Later (Hardening)
1. `web/tests/delegation-upload-flow.spec.ts`
- Current dependency: assumes import controls are immediately visible after opening Delegations.
- Future-safe change: click `delegations-subtab-received` before searching import controls.

2. `web/tests/revocation-flow.spec.ts`
- Current dependency: checks both `Delegations Received` and `Delegations Created` headings; some assertions rely on default view selection.
- Future-safe change: click `delegations-subtab-received` before received assertions and `delegations-subtab-created` before created assertions.

3. `web/tests/ipfs-network-verification.spec.ts`
- Current dependency: import controls are discovered without explicit sub-view selection.
- Future-safe change: click `delegations-subtab-received` before import interactions.

4. `web/tests/hardware-mode.spec.ts`
- Current dependency: mostly DID setup (`create-did-button`), low risk.
- Future-safe change: none required now; optionally click `delegations-subtab-identity` for strictness when asserting identity-specific UI.

5. `web/tests/basic-ui.spec.ts`
- Current dependency: setup flow and DID creation (`create-did-button`) while no DID exists.
- Future-safe change: none required now.

## Suggested Test Helper (optional)
Use a helper to remove repeated sub-view click code:

```ts
async function openDelegationsSubtab(page: Page, tab: 'received' | 'created' | 'identity') {
  await page.getByRole('button', { name: /delegations/i }).click();
  await page.getByTestId(`delegations-subtab-${tab}`).click();
}
```
