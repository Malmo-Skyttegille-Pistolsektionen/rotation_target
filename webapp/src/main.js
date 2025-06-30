import { initializeRunTab } from './programs.js'; // programs.js now manages the Run tab
import { initializeAudiosTab, refreshAudioList } from './audios.js';
import { initializeUploadProgramTab } from './upload-program.js';
import { EventType, connectToEventStream } from './sse-client.js';

import { getStatus } from './rest-client.js';
import { setCurrent, clearCurrent } from './timeline.js';

document.addEventListener("DOMContentLoaded", async () => {

  // Program state to track the current program and series
  const programState = {
    program_id: null,
    series_running: false, // Updated: Only true when a series is actively running
    current_series_index: null,
    current_event_index: null,
    target_status_shown: false // Changed from string to boolean
  };

  const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
  const appName = "Malmö Skyttegille Rotation Target";
  const appTitle = `${appName} v${appVersion}`;
  document.title = appTitle;
  document.querySelector("#footer span").textContent = appTitle;

  // Initialize tabs
  await initializeRunTab();

  const runTabButton = document.getElementById("run-tab-button");
  const audioTabButton = document.getElementById("audio-tab-button");
  const uploadProgramTabButton = document.getElementById("upload-program-tab-button");

  const runSection = document.getElementById("run-section");
  const audioSection = document.getElementById("audio-section");
  const uploadProgramSection = document.getElementById("upload-program-section");

  // Tab switching logic
  runTabButton.addEventListener("click", async () => {
    runTabButton.classList.add("active");
    audioTabButton.classList.remove("active");
    uploadProgramTabButton.classList.remove("active");

    runSection.classList.remove("hidden");
    audioSection.classList.add("hidden");
    uploadProgramSection.classList.add("hidden");
    await initializeRunTab();
  });

  audioTabButton.addEventListener("click", async () => {
    audioTabButton.classList.add("active");
    runTabButton.classList.remove("active");
    uploadProgramTabButton.classList.remove("active");

    audioSection.classList.remove("hidden");
    runSection.classList.add("hidden");
    uploadProgramSection.classList.add("hidden");

    await initializeAudiosTab();
  });

  uploadProgramTabButton.addEventListener("click", () => {
    uploadProgramTabButton.classList.add("active");
    runTabButton.classList.remove("active");
    audioTabButton.classList.remove("active");

    uploadProgramSection.classList.remove("hidden");
    runSection.classList.add("hidden");
    audioSection.classList.add("hidden");

    initializeUploadProgramTab();
  });

  // Broadcast SSE events
  connectToEventStream((type, payload) => {
    console.log('SSE Event:', type, payload);
    const event = new CustomEvent(type, { detail: payload });
    document.dispatchEvent(event);
  });

});