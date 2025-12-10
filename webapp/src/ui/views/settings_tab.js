import { connectToEventStream, currentSSESource } from "../../apis/sse-client.js";
import { fetchAdminModeStatus, enableAdminMode, disableAdminMode } from "../../apis/rest-client.js";

// Read from localStorage if set, else default to localhost
const getBaseUrl = () =>
    localStorage.getItem("SERVER_BASE_URL") || "http://localhost";

export let SERVER_BASE_URL = getBaseUrl();
export let SERVER_API_URL = `${SERVER_BASE_URL}/api/v1`;
export let SERVER_SSE_URL = `${SERVER_BASE_URL}/sse/v1`;

// Admin token for managing admin mode
let adminToken = localStorage.getItem("ADMIN_BEARER_TOKEN") || null;

// Call this to update the base URL at runtime
export function setServerBaseUrl(newUrl) {
    SERVER_BASE_URL = newUrl;
    SERVER_API_URL = `${SERVER_BASE_URL}/api/v1`;
    SERVER_SSE_URL = `${SERVER_BASE_URL}/sse/v1`;
    localStorage.setItem("SERVER_BASE_URL", newUrl);

    // Reset SSE connection if it exists
    if (typeof connectToEventStream === "function") {
        if (currentSSESource) {
            currentSSESource.close();
        }
        connectToEventStream(/* your event handler here */);
    }
}

// Initialize the Settings tab and handle the form
export function initializeSettingsTab() {
    const form = document.getElementById("settings-form");
    const input = document.getElementById("server-base-url");
    const status = document.getElementById("settings-status");

    // Admin mode elements
    const adminEnableForm = document.getElementById("admin-enable-form");
    const adminDisableForm = document.getElementById("admin-disable-form");
    const adminPasswordInput = document.getElementById("admin-password");
    const adminModeStatus = document.getElementById("admin-mode-status");

    // Set current value
    input.value = SERVER_BASE_URL;

    form.onsubmit = (e) => {
        e.preventDefault();
        const newUrl = input.value.trim();

        if (!newUrl || !isUrlValid(newUrl)) {
            status.textContent = "Please enter a valid URL.";
            status.style.color = "red";
            return;
        }
        setServerBaseUrl(newUrl);
        status.textContent = "Server Base URL updated!";
        status.style.color = "green";
        // Refresh admin mode status on server change
        updateAdminModeUI();
    };

    // Admin enable form
    adminEnableForm.onsubmit = async (e) => {
        e.preventDefault();
        const password = adminPasswordInput.value;
        adminModeStatus.textContent = "";
        try {
            const result = await enableAdminMode(password);
            adminToken = result.token;
            localStorage.setItem("ADMIN_BEARER_TOKEN", adminToken);
            adminPasswordInput.value = "";
            adminModeStatus.textContent = "Admin mode enabled!";
            adminModeStatus.style.color = "green";
            updateAdminModeUI();
        } catch (err) {
            adminModeStatus.textContent = "Failed to enable admin mode.";
            adminModeStatus.style.color = "red";
        }
    };

    // Admin disable form
    adminDisableForm.onsubmit = async (e) => {
        e.preventDefault();
        adminModeStatus.textContent = "";
        try {
            await disableAdminMode();
            adminToken = null;
            localStorage.removeItem("ADMIN_BEARER_TOKEN");
            adminModeStatus.textContent = "Admin mode disabled!";
            adminModeStatus.style.color = "green";
            updateAdminModeUI();
        } catch (err) {
            adminModeStatus.textContent = "Failed to disable admin mode.";
            adminModeStatus.style.color = "red";
        }
    };

    // Always update admin mode UI on tab open
    async function updateAdminModeUI() {
        try {
            const { enabled } = await fetchAdminModeStatus();
            if (!enabled) {
                // Admin mode is disabled: show enable form, hide disable form
                adminEnableForm.classList.remove("hidden");
                adminDisableForm.classList.add("hidden");
                adminModeStatus.textContent = "Admin mode is disabled.";
                adminModeStatus.style.color = "gray";
            } else {
                // Admin mode is enabled
                if (adminToken) {
                    // Token exists: show disable button
                    adminEnableForm.classList.add("hidden");
                    adminDisableForm.classList.remove("hidden");
                    adminModeStatus.textContent = "Admin mode is enabled.";
                    adminModeStatus.style.color = "green";
                } else {
                    // No token: inform user
                    adminEnableForm.classList.add("hidden");
                    adminDisableForm.classList.add("hidden");
                    adminModeStatus.textContent = "Admin mode is enabled (by another client).";
                    adminModeStatus.style.color = "orange";
                }
            }
        } catch (err) {
            adminModeStatus.textContent = "Could not fetch admin mode status.";
            adminModeStatus.style.color = "red";
        }
    }

    // Expose for tab switching logic
    initializeSettingsTab.updateAdminModeUI = updateAdminModeUI;
    updateAdminModeUI();
}

function isUrlValid(newUrl) {
    try {
        const url = new URL(newUrl);
        // Basic check: must start with http or https
        if (!/^https?:$/.test(url.protocol)) return false;
        // Check for valid hostname or IPv4 address
        if (
            /^[a-zA-Z0-9.-]+$/.test(url.hostname) || // hostname
            /^(\d{1,3}\.){3}\d{1,3}$/.test(url.hostname) // IPv4
        ) {
            // Optionally, check for valid IPv4 octets
            if (/^(\d{1,3}\.){3}\d{1,3}$/.test(url.hostname)) {
                return url.hostname.split('.').every(part => {
                    const n = Number(part);
                    return n >= 0 && n <= 255;
                });
            }
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}
