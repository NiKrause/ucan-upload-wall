# 🚀 UCAN Revocation Quick Start Guide

## Testing the Revocation Feature

### Prerequisites
- Two browser profiles or devices (Browser A and Browser B)
- Storacha credentials on Browser A OR
- A delegation already created and shared

### Test Scenario 1: Create and Revoke

**Browser A (Creator):**

1. Open the app in Browser A
2. Set up Ed25519 DID and Storacha credentials
3. Note your Ed25519 DID (copy it)

4. **Create a delegation:**
   - Go to "Delegations" tab
   - Click "Create New Delegation"
   - Enter Browser B's DID as target
   - Select capabilities (e.g., `space/blob/add`, `upload/add`)
   - Click "Create Delegation"
   - Copy the delegation proof

**Browser B (Recipient):**

5. Open the app in Browser B (different profile/incognito)
6. Set up Ed25519 DID (it will be different from Browser A)
7. Copy your DID

8. **Import the delegation:**
   - Go to "Delegations" tab
   - Click "Import UCAN Token"
   - Paste the delegation proof from Browser A
   - Click "Import UCAN Token"
   - 🎉 **Automatic navigation**: You'll be taken to the Upload screen
   - Files will reload in the background

9. **Test Upload (Should Work):**
   - You're already on the "Upload" screen (automatically navigated)
   - Try uploading a file
   - Should succeed! ✅

**Browser A (Revoke):**

10. **Revoke the delegation:**
    - Go to "Delegations" tab
    - Find the delegation you created (in "Delegations Created" section)
    - Click the "Revoke" button (red, with X icon)
    - Confirm the action
    - Status should change from "Active" (green) to "Revoked" (red)

**Browser B (Verify Blocked):**

11. **Try Upload Again (Should Fail):**
    - Go to "Upload" tab
    - Try uploading a file
    - Should fail with error: "Cannot upload: Delegation has been revoked" ❌

### Expected UI Behavior

#### Active Delegation
- ✅ **Badge**: Green "Active" with checkmark
- **Border**: Gray
- **Background**: Green gradient
- **Actions**: "Revoke" button visible

#### Revoked Delegation
- 🚫 **Badge**: Red "Revoked" with ban icon
- **Border**: Red
- **Background**: Red gradient (semi-transparent)
- **Banner**: Red info box showing revocation time and revoker DID
- **Actions**: "Revoke" button hidden (already revoked)
- **Message**: "This delegation is no longer valid"

#### Expired Delegation
- ⏰ **Badge**: Orange "Expired" with clock icon
- **Border**: Orange
- **Background**: Orange gradient (semi-transparent)
- **Actions**: "Revoke" button still visible (can revoke expired delegations)

### Test Scenario 2: Revocation Status Check

1. Create and share a delegation
2. Wait for recipient to use it successfully
3. Revoke the delegation
4. Recipient tries to use it again
5. Should see immediate failure (within 5 minutes due to cache)
6. To test immediate effect, recipient can refresh the page

### Common Issues

#### "Delegation not found in local store"
- The delegation you're trying to revoke wasn't created by this browser
- Make sure you're on the browser that created the delegation

#### "Failed to revoke delegation"
- Check browser console for detailed error
- Verify network connection
- Storacha service might be temporarily unavailable

#### Upload still works after revocation
- Cache might still be active (5 minute TTL)
- Refresh the page to force a new revocation check
- Check that revocation succeeded (status shows "Revoked")

### Debugging

**Check Revocation Status:**
```javascript
// Open browser console
const delegationCID = 'bafyreib...'; // Your delegation CID
const response = await fetch(`https://up.storacha.network/revocations/${delegationCID}`);
console.log('Status:', response.status); // 404 = not revoked, 200 = revoked
if (response.ok) {
  const data = await response.json();
  console.log('Revocation data:', data);
}
```

**Check Cache:**
```javascript
// Open browser console
const cache = localStorage.getItem('revocation_cache');
console.log('Revocation cache:', JSON.parse(cache));
```

**Clear Cache:**
```javascript
// Open browser console
localStorage.removeItem('revocation_cache');
console.log('Cache cleared');
```

### Performance Notes

- First revocation check: ~100-300ms (API call)
- Cached checks: <1ms (instant)
- Cache TTL: 5 minutes
- Cache automatically refreshed after TTL

### Security Notes

- Revocation is **permanent** and **cannot be undone**
- Both issuer and audience can revoke a delegation
- Revoked delegations are tracked in Storacha's global registry
- All operations validate delegation status before execution

### Next Steps

After successful testing:

1. ✅ Verify revocation flow works end-to-end
2. ✅ Check UI correctly shows status changes
3. ✅ Confirm blocked operations show clear error messages
4. 📝 Write Playwright E2E tests
5. 🚀 Deploy to production

---

**Questions?** Check [REVOCATION_IMPLEMENTATION.md](./REVOCATION_IMPLEMENTATION.md) for detailed technical documentation.
