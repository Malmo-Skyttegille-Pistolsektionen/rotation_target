# Admin Mode Authentication Flow

## Purpose

Admin mode is designed for **competition scenarios** where:

- **Spectators and competitors** can view the site to see current program status, timeline, and target states
- **Only competition hosts (admins)** can control the rotation targets and manage the program
- Admin mode ensures random visitors cannot accidentally or maliciously interfere with the competition

## Three States

### 1. Admin Mode OFF (Practice Mode)

**Who:** Everyone  
**Access:** Full read/write access to all endpoints  
**Use case:** Practice sessions, training, development

```
┌─────────────────────────────────────┐
│ Admin Mode: OFF                     │
│ Access: Full public access          │
│                                     │
│ [ Enable Admin Mode ]               │
└─────────────────────────────────────┘
```

### 2. Admin Mode ON + Not Authenticated (Spectator Mode)

**Who:** Non-authenticated visitors  
**Access:** Read-only (view status, timeline, targets)  
**Use case:** Competition spectators, other competitors

```
┌─────────────────────────────────────┐
│ Admin Mode: ON 🔒                   │
│ Your Access: View only              │
│                                     │
│ Password: [____________]            │
│ [ Login as Admin ]                  │
│                                     │
│ Note: Admin controls are hidden.    │
│ Login to enable them.               │
└─────────────────────────────────────┘

Run Page shows:
👁 View Only - Login as admin to control
```

### 3. Admin Mode ON + Authenticated (Admin Mode)

**Who:** Authenticated admins only  
**Access:** Full control (load programs, start/stop/reset, toggle targets)  
**Use case:** Competition hosts, administrators

```
┌─────────────────────────────────────┐
│ Admin Mode: ON ✓                    │
│ Your Access: Full admin access      │
│                                     │
│ [ Logout ] [ Disable Admin Mode ]   │
└─────────────────────────────────────┘

Run Page shows all controls:
[ Start ] [ Reset ] [ Toggle Targets ]
```

## Key Principle: Server is Source of Truth

**Important:** The server is the single source of truth for admin mode status. Clients never cache or store the admin mode state locally.

- Admin mode status is fetched from server on app startup
- Status is refreshed periodically (every 30 seconds)
- Status is refreshed when window regains focus
- All clients (including incognito windows) see the same status

## Data Flow

### App Startup Sequence

```
1. App mounts
   │
   ▼
2. useAdminStatus hook runs
   │
   ▼
3. GET /admin-mode/status
   │
   ├──► Admin mode: OFF
   │    Show all controls
   │
   └──► Admin mode: ON
        Check for stored admin token in context
        │
        ├──► No token stored
        │    Show view-only UI
        │
        └──► Has token
             Send token with requests
             Show all controls if requests succeed
             Clear token on 401
```

### Making a Protected Request (Admin Mode ON)

```
User clicks "Start" button (authenticated)
   │
   ▼
POST /programs/start with Bearer token in header
   │
   ├──► Success (200)
   │    Program starts normally
   │
   └──► 401 Unauthorized
        (Token invalid - password changed or session expired)
        │
        ▼
   Client detects 401
   Clear token from context
   UI updates to "View Only" mode
   Show error: "Admin session expired - please login again"
```

### Enabling Admin Mode

**Note:** Any non-empty password can be used to enable admin mode. Each competition can set their own unique password.

```
User enters any password in Settings
   │
   ▼
POST /admin-mode/enable
{ password: "competition-secret-2024" }
   │
   ├──► Success (200)
   │    Server accepts any non-empty password
   │    Sets http-only cookie with token
   │    Returns: { token: "xxx" }
   │    │
   │    ▼
   │ Store token in React context
   │ UI updates to show "ON ✓" state
   │
   └──► 401 Unauthorized
        Empty password or invalid request
        Show error: "Invalid password"
```

### Login When Admin Mode Already Enabled

**Note:** Must use the same password that was used to enable admin mode. Each competition can have a different password.

```
Admin mode is ON, user has no token (view-only)
   │
   ▼
User enters password in Settings
   │
   ▼
POST /admin-mode/enable
{ password: "competition-secret-2024" }
   │
   ├──► Success (200)
   │    Server validates password matches current admin mode password
   │    Sets http-only cookie
   │    Returns: { token: "xxx" }
   │    │
   │    ▼
   │ Store token in React context
   │ UI updates - Run page now shows all controls
   │
   └──► 401 Unauthorized
        Wrong password for this competition
        Token from previous competition invalid
        Show error: "Invalid password"
```

### Disabling Admin Mode

```
Authenticated admin clicks "Disable Admin Mode"
   │
   ▼
POST /admin-mode/disable
   │
   ├──► Success (200)
   │    Server clears admin token
   │    Removes http-only cookie
   │    │
   │    ▼
   │ Clear token from context
   │ UI updates to "OFF" state
   │ All controls now available to everyone
   │
   └──► 401 Unauthorized
        Not authenticated as admin
        Show error: "Admin authentication required"
```

### Logout (Keep Admin Mode On)

```
Authenticated admin clicks "Logout"
   │
   ▼
Client clears token from context
   │
   ▼
UI updates - Run page hides controls
User is now in "View Only" mode
Admin mode remains ON on server
Other authenticated admins still have access
```

## Storage

### Server-Side (HTTP-Only Cookie) - THE ONLY STORAGE

- **Key:** `admin`
- **Value:** Random token string
- **Security:** HttpOnly, SameSite=Lax
- **Expiration:** Session (no explicit expiration)
- **Scope:** All clients sharing the same domain see the same cookie

### Client-Side (React Context)

- **adminToken:** Stored temporarily in React context only (not persisted)
- **Purpose:** Track if this specific browser tab/client has authenticated
- **Lifetime:** Lost on page refresh (must login again or use cookie)
- **Scope:** Per tab/client only

### Why No localStorage?

- **Synchronization:** localStorage is isolated per browser/incognito, causing desync
- **Security:** localStorage is accessible by JavaScript (XSS risk)
- **Single Source of Truth:** Server state must be authoritative
- **Multiple Clients:** All clients must see the same admin mode status

## Hook: useAdminStatus

```typescript
export function useAdminStatus() {
  const { setAdminToken, logoutAdmin } = useSettings();
  const adminApi = useAdminApi();
  const queryClient = useQueryClient();

  // Always fetch admin status from server - single source of truth
  const { data: adminStatus, isLoading } = useQuery({
    queryKey: ['admin-status'],
    queryFn: adminApi.fetchStatus,
    staleTime: 0, // Always fetch fresh data
    refetchOnWindowFocus: true,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  const adminModeEnabled = adminStatus?.enabled ?? false;

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: (password: string) => adminApi.enable(password),
    onSuccess: (data) => {
      setAdminToken(data.token);
      queryClient.invalidateQueries({ queryKey: ['admin-status'] });
    },
  });

  // Disable admin mode mutation
  const disableMutation = useMutation({
    mutationFn: () => adminApi.disable(),
    onSuccess: () => {
      logoutAdmin();
      queryClient.invalidateQueries({ queryKey: ['admin-status'] });
    },
  });

  return {
    adminModeEnabled,
    isLoading,
    login: loginMutation.mutate,
    disable: disableMutation.mutate,
    logout,
    isLoginPending: loginMutation.isPending,
    isDisablePending: disableMutation.isPending,
  };
}
```

## Context State

```typescript
interface SettingsContextType {
  settings: Settings;
  adminToken: string | null; // Stored in context only (not localStorage)
  setServerBaseUrl: (url: string) => void;
  setStartDelaySeconds: (seconds: number) => void;
  setAdminToken: (token: string | null) => void;
  logoutAdmin: () => void; // Clear token from context only
}
```

**Note:** `adminModeEnabled` is NOT in the context. It always comes from the server via `useAdminStatus` hook.

## Components Affected

### Settings Page

Always shows Admin Mode section with appropriate state:

- **OFF:** "Enable Admin Mode" button
- **ON + No Auth:** Password input + "Login as Admin" button
- **ON + Authenticated:** "Logout" and "Disable Admin Mode" buttons

Uses `useAdminStatus()` hook to get real-time status from server.

### Run Page

Conditional rendering based on `canControl = !adminModeEnabled || isAdminAuthenticated`:

- **Can control:** Show Start/Pause, Reset, Toggle Targets buttons
- **View only:** Show "👁 View Only - Login as admin to control" badge, hide all buttons

Uses `useAdminStatus()` for `adminModeEnabled` and checks for `adminToken` in context.

### API Client

- Sends `Authorization: Bearer <token>` header when token exists in context
- On 401 response: Calls `logoutAdmin()` to clear token from context
- All mutations go through authenticated client

## API Endpoints

### GET /admin-mode/status

**Response:** `{ enabled: boolean }`  
**Auth required:** No  
**Purpose:** Check if admin mode is enabled on server  
**Note:** This is public - any client can check if admin mode is on/off

### POST /admin-mode/enable

**Body:** `{ password: string }` - Any non-empty password is accepted when enabling admin mode for the first time. When admin mode is already enabled, the same password must be used to authenticate.  
**Response:** `{ token: string }`  
**Auth required:** No (but requires matching password when mode is already enabled)  
**Purpose:** Enable admin mode OR authenticate when already enabled  
**Note:** Each competition can set their own unique password. The password is set when admin mode is first enabled and must be used for all subsequent logins until admin mode is disabled.

### POST /admin-mode/disable

**Response:** `{ message: string }`  
**Auth required:** Yes (must be authenticated admin)  
**Purpose:** Disable admin mode entirely

### All Other Endpoints (POST/PUT/DELETE)

**Auth required:** Only when admin mode is enabled  
**Behavior:**

- If admin mode OFF: Allow all requests
- If admin mode ON: Require valid Bearer token

### GET Endpoints (Read-Only)

**Auth required:** Never  
**Examples:**

- `GET /programs` - List all programs
- `GET /programs/{id}` - Get specific program
- `GET /audios` - List all audio files
- `GET /admin-mode/status` - Check admin mode status

## Authentication Check Priority

1. **Check admin mode status** (from server via useAdminStatus)
2. **If admin mode OFF:** Allow all requests ✓
3. **If admin mode ON:** Check for token in context
4. **If no token:** Block mutations, show view-only UI
5. **If has token:** Send with request, server validates
6. **If server returns 401:** Token invalid, clear from context and logout

## Security Considerations

1. **Server as Source of Truth:** Admin mode status is always determined by server state
2. **No Client Caching:** Clients never cache admin mode status; always fetch from server
3. **HTTP-Only Cookies:** Token stored in http-only cookie (not accessible by JavaScript)
4. **Context-Only Token:** Token reference stored only in React context (lost on refresh)
5. **Password Per Competition:** Each competition can use any password to enable admin mode
6. **CSRF Protection:** SameSite=Lax cookie attribute

## Error Handling

### 401 Unauthorized Responses

```typescript
// In API client
if (response.status === 401 && adminToken) {
  onAuthError(); // Clears token from context
}
```

### Invalid Password

- Server returns 401
- Client shows error message
- Token not stored
- User remains in view-only mode

### Token Invalid (Password Changed)

1. Client makes request with old token
2. Server returns 401
3. Client clears token from context
4. UI updates to view-only mode
5. User must login again with new password

## Testing Scenarios

### Scenario 1: Fresh Start (Admin Mode OFF)

1. Start app in browser
2. Start app in incognito window
3. Verify both show "Admin Mode: OFF"
4. Verify all controls work without login in both windows

### Scenario 2: Enable Admin Mode (Both Windows See It)

1. In main window, enter any password (e.g., "competition-2024")
2. Click "Enable Admin Mode"
3. Verify main window shows "Admin Mode: ON ✓"
4. Verify incognito window automatically shows "Admin Mode: ON 🔒"
5. Verify incognito shows view-only badge
6. Remember the password - you'll need it to login again

### Scenario 3: Login as Admin in Incognito

1. Incognito window shows view-only badge
2. In incognito Settings, enter the same password used to enable admin mode
3. Click "Login as Admin"
4. Verify incognito now shows "Admin Mode: ON ✓"
5. Verify both windows can control the program

### Scenario 4: Logout in One Window

1. Login in both windows
2. Click "Logout" in main window
3. Verify main window shows view-only
4. Verify incognito window still has admin access
5. Verify server still has admin mode ON

### Scenario 5: Disable Admin Mode (Both Windows See It)

1. Login as admin in main window
2. Click "Disable Admin Mode"
3. Verify main window shows "Admin Mode: OFF"
4. Verify incognito window automatically shows "Admin Mode: OFF"
5. Verify both windows show full controls without login

### Scenario 6: Password Change

1. Enable admin mode with password "old-password", login
2. Disable admin mode
3. Enable admin mode again with password "new-password"
4. Try to login with "old-password" - should fail
5. Login with "new-password" - should succeed
