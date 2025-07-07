import { connectToEventStream, currentSSESource } from "./sse-client.js";

// Read from localStorage if set, else default to localhost
const getBaseUrl = () =>
    localStorage.getItem("SERVER_BASE_URL") || "http://localhost:8080";

export let SERVER_BASE_URL = getBaseUrl();
export let SERVER_API_URL = `${SERVER_BASE_URL}/api/v1`;
export let SERVER_SSE_URL = `${SERVER_BASE_URL}/sse/v1`;

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
        // Reconnect with the new SERVER_SSE_URL
        connectToEventStream(/* your event handler here */);
    }
}

// Initialize the Settings tab and handle the form
export function initializeSettingsTab() {
    const form = document.getElementById("settings-form");
    const input = document.getElementById("server-base-url");
    const status = document.getElementById("settings-status");

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
    };
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
