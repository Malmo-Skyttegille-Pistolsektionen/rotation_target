# Control lock Authentication Flow

## Purpose

The control lock is designed for **competition scenarios** where:

- **Spectators and competitors** can view the site to see current program status, timeline, and target states
- **Only whoever is holding the lock** can control the rotation targets and manage the program
- The control lock ensures random visitors cannot accidentally or maliciously interfere with the competition

## Three States

### 1. Control lock OFF (Practice Mode)

**Who:** Everyone
**Access:** Full read/write access to all endpoints
**Use case:** Practice sessions, training, development

```
┌─────────────────────────────────────┐
│ Control lock: OFF                     │
│ Access: Full public access          │
│                                     │
│ [ Enable Control lock ]               │
└─────────────────────────────────────┘
```

### 2. Control lock ON + Not Authenticated (Spectator Mode)

**Who:** Non-authenticated visitors
**Access:** Read-only (view status, timeline, targets)
**Use case:** Competition spectators, other competitors

```
┌─────────────────────────────────────┐
│ Control lock: ON 🔒                   │
│ Your Access: View only              │
│                                     │
│ Password: [____________]            │
│ [ Log in ]                  │
│                                     │
│ Note: the controls are hidden.    │
│ Login to enable them.               │
└─────────────────────────────────────┘

Run Page shows:
👁 View Only - Login in to control
```

### 3. Control lock ON + Authenticated (Control lock)

**Who:** whoever is holding the lock
**Access:** Full control (load programs, start/stop/reset, toggle targets)
**Use case:** the person running a competition

```
┌─────────────────────────────────────┐
│ Control lock: ON ✓                    │
│ You are holding the lock      │
│                                     │
│ [ Logout ] [ Disable Control lock ]   │
└─────────────────────────────────────┘

Run Page shows all controls:
[ Start ] [ Reset ] [ Toggle Targets ]
```

## Key Principle: Server is Source of Truth

**Important:** The server is the single source of truth for the control lock status. Clients never cache or store the the control lock state locally.

- The control lock status is fetched from server on app startup
- Status is refreshed periodically (every 30 seconds)
- Status is refreshed when window regains focus
- All clients (including incognito windows) see the same status

## Data Flow

### App Startup Sequence

```
1. App mounts
   │
   ▼
2. useControlLockStatus hook runs
   │
   ▼
3. GET /control-lock/status
   │
   ├──► The control lock: OFF
   │    Show all controls
   │
   └──► The control lock: ON
        Check for stored control lock token in context
        │
        ├──► No token stored
        │    Show view-only UI
        │
        └──► Has token
             Send token with requests
             Show all controls if requests succeed
             Clear token on 401
```

### Making a Protected Request (Control lock ON)

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
   Show error: "Session expired - please log in again"
```

### Enabling Control lock

**Note:** Any non-empty password can be used to turn the control lock on. That password becomes the shared password until the lock is turned off.

```
User enters any password in Settings
   │
   ▼
POST /control-lock/enable
{ password: "competition-secret-2024" }
   │
   ├──► Success (200)
   │    Server accepts any non-empty password
   │    Stores it as the active password
   │    Sets the control_lock cookie with the token
   │    Returns: { token: "xxx" }
   │    │
   │    ▼
   │ Store token in React context
   │ UI updates to show "ON ✓" state
   │
   └──► 409 Conflict
        Control lock already on
        Show error: "The control lock is already on. Log in, or turn it off before turning it on again."
```

### Login When Control lock Already Enabled

**Note:** Must use the same password that was used to turn the control lock on. Several people can log in at the same time and each gets their own session token.

```
The control lock is ON, user has no token (view-only)
   │
   ▼
User enters password in Settings
   │
   ▼
POST /control-lock/login
{ password: "competition-secret-2024" }
   │
   ├──► Success (200)
   │    Server validates password matches current the control lock password
   │    Sets the control_lock cookie
   │    Returns: { token: "xxx" }
   │    │
   │    ▼
   │ Store token in React context
   │ UI updates - Run page now shows all controls
   │
   └──► 401 Unauthorized
        Wrong password for this competition
        Show error: "Invalid password"
```

### Disabling Control lock

```
Whoever holds the lock clicks "Turn the lock off"
   │
   ▼
POST /control-lock/disable
   │
   ├──► Success (200)
   │    Server clears control lock token
   │    Removes http-only cookie
   │    │
   │    ▼
   │ Clear token from context
   │ UI updates to "OFF" state
   │ All controls now available to everyone
   │
   └──► 401 Unauthorized
        Not authenticated in
        Show error: "The controls are locked - log in first"
```

### Logout (Keep Control lock On)

```
Whoever holds the lock clicks "Log out"
   │
   ▼
Client clears token from context
   │
   ▼
UI updates - Run page hides controls
User is now in "View Only" mode
The control lock remains ON on server
Everyone else holding the lock still has access
```

## Storage

### Server-Side (HTTP-Only Cookie) - THE ONLY STORAGE

- **Key:** `control_lock`
- **Value:** Random token string
- **Security:** HttpOnly, SameSite=Lax
- **Expiration:** Session (no explicit expiration)
- **Scope:** All clients sharing the same domain see the same cookie

### Client-Side (React Context)

- **controlLockToken:** Stored temporarily in React context only (not persisted)
- **Purpose:** Track if this specific browser tab/client has authenticated
- **Lifetime:** Lost on page refresh (must login again or use cookie)
- **Scope:** Per tab/client only

### Why No localStorage?

- **Synchronization:** localStorage is isolated per browser/incognito, causing desync
- **Security:** localStorage is accessible by JavaScript (XSS risk)
- **Single Source of Truth:** Server state must be authoritative
- **Multiple Clients:** All clients must see the same the control lock status

## Hook: useControlLockStatus

```typescript
export function useControlLockStatus() {
  const { setControlLockToken, logoutControlLock } = useSettings();
  const controlLockApi = useControlLockApi();
  const queryClient = useQueryClient();

  // Always fetch the lock's state from the device - single source of truth
  const { data: controlLockStatus, isLoading } = useQuery({
    queryKey: ['control-lock-status'],
    queryFn: controlLockApi.fetchStatus,
    staleTime: 0, // Always fetch fresh data
    refetchOnWindowFocus: true,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  const controlLockEnabled = controlLockStatus?.enabled ?? false;

  // Enable mutation
  const enableMutation = useMutation({
    mutationFn: (password: string) => controlLockApi.enable(password),
    onSuccess: (data) => {
      setControlLockToken(data.token);
      queryClient.invalidateQueries({ queryKey: ['control-lock-status'] });
    },
  });

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: (password: string) => controlLockApi.login(password),
    onSuccess: (data) => {
      setControlLockToken(data.token);
      queryClient.invalidateQueries({ queryKey: ['control-lock-status'] });
    },
  });

  // Turn the control lock off mutation
  const disableMutation = useMutation({
    mutationFn: () => controlLockApi.disable(),
    onSuccess: () => {
      logoutControlLock();
      queryClient.invalidateQueries({ queryKey: ['control-lock-status'] });
    },
  });

  return {
    controlLockEnabled,
    isLoading,
    enable: enableMutation.mutateAsync,
    login: loginMutation.mutateAsync,
    disable: disableMutation.mutateAsync,
    logout,
    isEnablePending: enableMutation.isPending,
    isLoginPending: loginMutation.isPending,
    isDisablePending: disableMutation.isPending,
  };
}
```

## Context State

```typescript
interface SettingsContextType {
  settings: Settings;
  controlLockToken: string | null; // Stored in context only (not localStorage)
  setServerBaseUrl: (url: string) => void;
  setStartDelaySeconds: (seconds: number) => void;
  setControlLockToken: (token: string | null) => void;
  logoutControlLock: () => void; // Clear token from context only
}
```

**Note:** `controlLockEnabled` is NOT in the context. It always comes from the server via `useControlLockStatus` hook.

## Components Affected

### Settings Page

Always shows Control lock section with appropriate state:

- **OFF:** "Enable Control lock" button
- **ON + No Auth:** Password input + "Log in" button
- **ON + Authenticated:** "Logout" and "Disable Control lock" buttons

Uses `useControlLockStatus()` hook to get real-time status from server.

### Run Page

Conditional rendering based on `canControl = !controlLockEnabled || isHoldingLock`:

- **Can control:** Show Start/Pause, Reset, Toggle Targets buttons
- **View only:** Show "👁 View Only - Login in to control" badge, hide all buttons

Uses `useControlLockStatus()` for `controlLockEnabled` and checks for `controlLockToken` in context.

### API Client

- Sends `Authorization: Bearer <token>` header when token exists in context
- On 401 response: Calls `logoutControlLock()` to clear token from context
- All mutations go through authenticated client

## API Endpoints

### GET /control-lock/status

**Response:** `{ enabled: boolean }`
**Auth required:** No
**Purpose:** Check if the control lock is on on server
**Note:** This is public - any client can check if the control lock is on/off

### POST /control-lock/enable

**Body:** `{ password: string }` - Any non-empty password is accepted when the control lock is off.
**Response:** `{ token: string }`
**Auth required:** No
**Purpose:** Turn the control lock on and issue the first control lock session
**Errors:** `409` if the control lock is already enabled
**Note:** Each competition can set their own unique password. The password is set when the control lock is first enabled and must be used for every later login until the lock is turned off.

### POST /control-lock/login

**Body:** `{ password: string }` - Must match the password the lock was turned on with.
**Response:** `{ token: string }`
**Auth required:** No
**Purpose:** Authenticate another control lock session while the control lock is already enabled
**Errors:** `409` if the control lock is not enabled

### POST /control-lock/disable

**Response:** `{ message: string }`
**Auth required:** Yes (must be holding the lock)
**Purpose:** Turn the control lock off entirely

### All Other Endpoints (POST/PUT/DELETE)

**Auth required:** Only when the control lock is on
**Behavior:**

- If the control lock OFF: Allow all requests
- If the control lock ON: Require valid Bearer token

### GET Endpoints (Read-Only)

**Auth required:** Never
**Examples:**

- `GET /programs` - List all programs
- `GET /programs/{id}` - Get specific program
- `GET /audios` - List all audio files
- `GET /control-lock/status` - Check the control lock status

## Authentication Check Priority

1. **Check the control lock status** (from server via useControlLockStatus)
2. **If the control lock OFF:** Allow all requests ✓
3. **If the control lock ON:** Check for token in context
4. **If no token:** Block mutations, show view-only UI
5. **If has token:** Send with request, server validates
6. **If server returns 401:** Token invalid, clear from context and logout

## Security Considerations

1. **Server as Source of Truth:** The control lock status is always determined by server state
2. **No Client Caching:** Clients never cache the control lock status; always fetch from server
3. **HTTP-Only Cookies:** Token stored in http-only cookie (not accessible by JavaScript)
4. **Context-Only Token:** Token reference stored only in React context (lost on refresh)
5. **Password Per Competition:** Each competition can use any password to turn the control lock on
6. **CSRF Protection:** SameSite=Lax cookie attribute

## Error Handling

### 401 Unauthorized Responses

```typescript
// In API client
if (response.status === 401 && controlLockToken) {
  onAuthError(); // Clears token from context
}
```

### Invalid Password

- Server returns 401
- Client shows error message
- Token not stored
- User remains in view-only mode

### Wrong Endpoint For Current State

- `POST /control-lock/enable` returns 409 if the control lock is already enabled
- `POST /control-lock/login` returns 409 if the control lock is not enabled
- Client shows the server error message

### Token Invalid (Password Changed)

1. Client makes request with old token
2. Server returns 401
3. Client clears token from context
4. UI updates to view-only mode
5. User must login again with new password

## Testing Scenarios

### Scenario 1: Fresh Start (Control lock OFF)

1. Start app in browser
2. Start app in incognito window
3. Verify both show "Control lock: OFF"
4. Verify all controls work without login in both windows

### Scenario 2: Enable Control lock (Both Windows See It)

1. In main window, enter any password (e.g., "competition-2024")
2. Click "Enable Control lock"
3. Verify main window shows "Control lock: ON ✓"
4. Verify incognito window automatically shows "Control lock: ON 🔒"
5. Verify incognito shows view-only badge
6. Remember the password - you'll need it to login again

### Scenario 3: Log in from an incognito window

1. Incognito window shows view-only badge
2. In incognito Settings, enter the same password used to turn the control lock on
3. Click "Log in"
4. Verify incognito now shows "Control lock: ON ✓"
5. Verify both windows can control the program

### Scenario 4: Logout in One Window

1. Login in both windows
2. Click "Logout" in main window
3. Verify main window shows view-only
4. Verify incognito window still hin access
5. Verify server still has the control lock ON

### Scenario 5: Disable Control lock (Both Windows See It)

1. Login in in main window
2. Click "Disable Control lock"
3. Verify main window shows "Control lock: OFF"
4. Verify incognito window automatically shows "Control lock: OFF"
5. Verify both windows show full controls without login

### Scenario 6: Password Change

1. Turn the control lock on with password "old-password", login
2. Turn the control lock off
3. Turn the control lock on again with password "new-password"
4. Try to login with "old-password" - should fail
5. Login with "new-password" - should succeed
