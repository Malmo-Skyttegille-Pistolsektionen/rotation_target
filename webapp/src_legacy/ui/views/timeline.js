import { getAudioTitleById } from '../../models/audios.js';

export const TimelineType = Object.freeze({
  Default: "default",
  Field: "field"
});

// Threshold for automatic timeline type detection (in milliseconds)
// Events with durations at or below this threshold will use Field timeline (time-scaled)
const FIELD_TIMELINE_THRESHOLD_MS = 30000; // 30 seconds

let currentSeriesIndex = null;
let currentEventIndex = null;
let timelineData = null;

// Detect appropriate timeline type based on program characteristics
export function detectTimelineType(program) {
  if (!program || !program.series || program.series.length === 0) {
    return TimelineType.Default;
  }

  // Calculate the maximum event duration across all series
  let maxDuration = 0;
  for (const series of program.series) {
    if (series.events) {
      for (const event of series.events) {
        if (event.duration > maxDuration) {
          maxDuration = event.duration;
        }
      }
    }
  }

  // If max duration is at or below threshold, use Field timeline (time-scaled)
  // Otherwise use Default timeline (event-based)
  return maxDuration <= FIELD_TIMELINE_THRESHOLD_MS ? TimelineType.Field : TimelineType.Default;
}

// Main timeline renderer with enum type selection
export function renderTimeline(placeHolder, program, type = null) {
  // Auto-detect type if not specified
  if (type === null) {
    type = detectTimelineType(program);
  }

  if (type === TimelineType.Field) {
    renderFieldTimeline(placeHolder, program);
  } else {
    renderDefaultTimeline(placeHolder, program);
  }
}

// Default timeline renderer (existing logic)
export function renderDefaultTimeline(placeHolder, program) {
  placeHolder.innerHTML = "";

  timelineData = preprocess(program.series);

  // Tooltip element for default timeline
  let tooltip = document.createElement("div");
  tooltip.className = "timeline-tooltip";
  placeHolder.appendChild(tooltip);

  timelineData.forEach((series, sIdx) => {
    const wrapper = document.createElement("div");
    wrapper.className = "series";
    if (series.optional) wrapper.classList.add("optional");
    wrapper.dataset.seriesIndex = sIdx;

    const title = document.createElement("div");
    title.className = "series-title";
    title.textContent = series.name + (series.optional ? " (optional)" : "");
    wrapper.appendChild(title);

    const row = document.createElement("div");
    row.className = "events";

    series.events.forEach((ev, eIdx) => {
      const evDiv = document.createElement("div");
      evDiv.className = `event ${ev.symbolClass}`;
      evDiv.dataset.eventIndex = eIdx;

      // Tooltip logic for default timeline
      evDiv.addEventListener("mouseenter", () => {
        let audioList = "";
        if (ev.audio_ids && ev.audio_ids.length > 0) {
          audioList = "<br>Audios:<br>" +
            ev.audio_ids
              .map(id => {
                const title = getAudioTitleById(id);
                return `"${title}" (${id})`;
              })
              .join("<br>");
        }
        tooltip.innerHTML =
          `<strong>Duration:</strong> ${Math.trunc(ev.duration / 1000)}s<br>` +
          `<strong>Command:</strong> ${ev.command || "none"}${audioList}`;
        tooltip.style.display = "block";
        const rect = evDiv.getBoundingClientRect();
        tooltip.style.left = `${rect.left + window.scrollX}px`;
        tooltip.style.top = `${rect.top + window.scrollY - 40}px`;
      });
      evDiv.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
      });

      const dur = document.createElement("div");
      dur.className = "dur";
      dur.textContent = Math.trunc(ev.duration / 1000);
      evDiv.appendChild(dur);

      const sym = document.createElement("div");
      sym.className = "symbol";
      sym.textContent = ev.symbolText;
      evDiv.appendChild(sym);

      const acc = document.createElement("div");
      acc.className = "acc";
      acc.textContent = Math.trunc(ev.acc / 1000);
      evDiv.appendChild(acc);

      if (ev.audio_ids && ev.audio_ids.length > 0) {
        const audioTitles = ev.audio_ids.map(getAudioTitleById).join(", ");
        evDiv.setAttribute("title", audioTitles);
      }

      row.appendChild(evDiv);
    });

    wrapper.appendChild(row);
    placeHolder.appendChild(wrapper);
  });
}

// Improved field/logic timeline renderer
export function renderFieldTimeline(placeHolder, program) {
  placeHolder.innerHTML = "";

  // Tooltip element (one per timeline)
  let tooltip = document.createElement("div");
  tooltip.className = "logic-timeline-tooltip";
  placeHolder.appendChild(tooltip);

  const timelineData = preprocess(program.series);

  timelineData.forEach((series, sIdx) => {
    // Timeline container for each series
    const timelineContainer = document.createElement("div");
    timelineContainer.className = "logic-timeline-container";
    if (series.optional) timelineContainer.classList.add("optional");
    timelineContainer.dataset.seriesIndex = sIdx;

    // Series info/title
    const title = document.createElement("div");
    title.className = "series-title";
    title.textContent = series.name + (series.optional ? " (optional)" : "");
    timelineContainer.appendChild(title);

    // Center line
    const centerLine = document.createElement("div");
    centerLine.className = "logic-timeline-centerline";

    // Segments
    let totalDuration = 0;
    series.events.forEach((ev) => {
      const durationSec = Math.max(1, Math.trunc(ev.duration / 1000));
      const segment = document.createElement("div");
      segment.className = `logic-segment ${ev.command || ""}`;
      segment.style.width = `${durationSec * 40}px`;
      segment.dataset.duration = ev.duration; // Store original duration

      // Info line (duration and audio symbol)
      const infoLine = document.createElement("div");
      infoLine.className = "logic-info-line";
      infoLine.textContent = `${durationSec}s`;
      if (ev.audio_ids) {
        infoLine.textContent += " A";
      }
      segment.appendChild(infoLine);

      // Tooltip logic for field timeline
      segment.addEventListener("mouseenter", (e) => {
        let audioList = "";
        if (ev.audio_ids && ev.audio_ids.length > 0) {
          audioList = "<br>Audios:<br>" +
            ev.audio_ids
              .map(id => {
                const title = getAudioTitleById(id);
                return `"${title}" (${id})`;
              })
              .join("<br>");
        }
        tooltip.innerHTML =
          `<strong>Duration:</strong> ${durationSec}s<br>` +
          `<strong>Command:</strong> ${ev.command || "none"}${audioList}`;
        tooltip.style.display = "block";
        const rect = segment.getBoundingClientRect();
        tooltip.style.left = `${rect.left + window.scrollX}px`;
        tooltip.style.top = `${rect.top + window.scrollY - 40}px`;
      });
      segment.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
      });

      // Position segment above or on the center line using CSS classes only
      if (ev.command === "show") {
        segment.classList.add("above");
      } else if (ev.command === "hide") {
        segment.classList.add("on-line");
      }

      segment.title = `${ev.command || ""} (${durationSec}s)`;
      centerLine.appendChild(segment);

      totalDuration += durationSec;
    });

    // Axis (seconds)
    const axis = document.createElement("div");
    axis.className = "logic-timeline-axis";
    axis.style.position = "relative";
    axis.style.width = `${totalDuration * 40}px`; // 40px per second

    for (let i = 0; i <= totalDuration; i++) {
      const tick = document.createElement("span");
      tick.className = "logic-timeline-tick";
      tick.textContent = i;
      tick.id = `logic-tick-${sIdx}-${i}`;
      tick.dataset.seriesIndex = sIdx;
      tick.dataset.second = i;
      tick.style.position = "absolute";
      tick.style.left = `${i * 40}px`; // Align tick with segment end
      tick.style.transform = "translateX(-50%)";
      axis.appendChild(tick);
    }

    timelineContainer.appendChild(centerLine);
    timelineContainer.appendChild(axis);
    placeHolder.appendChild(timelineContainer);
  });
}

// preprocess, setCurrent, clearCurrent unchanged
function preprocess(seriesList) {
  return seriesList.map((series) => {
    let acc = 0;
    const events = series.events.map(ev => {
      const duration = ev.duration;
      let symbolClass;
      let symbolText = "";

      if (ev.audio_ids && ev.audio_ids.length > 0) {
        symbolText = "A";
        if (ev.command === "show") {
          symbolClass = "show audio";
        } else if (ev.command === "hide") {
          symbolClass = "hide audio";
        } else {
          symbolClass = "audio";
        }
      } else if (ev.command === "show") {
        symbolClass = "show";
      } else if (ev.command === "hide") {
        symbolClass = "hide";
      } else {
        symbolClass = "no-action";
      }

      acc += duration;
      const entry = { ...ev, duration, acc, symbolClass, symbolText };
      return entry;
    });
    return { ...series, events };
  });
}

export function setCurrent(si, ei) {
  currentSeriesIndex = si;
  currentEventIndex = ei;

  // Remove previous highlights for both timelines
  document.querySelectorAll(".series").forEach(s => s.classList.remove("current"));
  document.querySelectorAll(".event").forEach(e => e.classList.remove("current"));
  document.querySelectorAll(".logic-segment").forEach(seg => seg.classList.remove("current"));
  document.querySelectorAll(".logic-timeline-container").forEach(c => c.classList.remove("current"));

  // Highlight current series/event in default timeline
  const currentSeries = document.querySelector(`[data-series-index='${si}']`);
  if (currentSeries) {
    currentSeries.classList.add("current");
    const currentEvent = currentSeries.querySelector(`[data-event-index='${ei}']`);
    if (currentEvent) currentEvent.classList.add("current");
  }

  // Highlight current series/event in field timeline
  const fieldSeries = document.querySelectorAll(".logic-timeline-container")[si];
  if (fieldSeries) {
    fieldSeries.classList.add("current");
    const segments = fieldSeries.querySelectorAll(".logic-segment");
    if (segments[ei]) segments[ei].classList.add("current");
  }
}

export function clearCurrent() {
  currentSeriesIndex = null;
  currentEventIndex = null;
  document.querySelectorAll(".series").forEach(s => s.classList.remove("current"));
  document.querySelectorAll(".event").forEach(e => e.classList.remove("current"));
}

export function setCurrentChrono(seriesIdx, elapsedMs) {
  const timelineContainers = document.querySelectorAll('.logic-timeline-container');
  
  // Remove all existing cursors from other series
  timelineContainers.forEach((container, idx) => {
    if (idx !== seriesIdx) {
      const axis = container.querySelector('.logic-timeline-axis');
      if (axis) {
        const cursor = axis.querySelector('.logic-timeline-cursor');
        if (cursor) cursor.remove();
      }
    }
  });
  
  const timelineContainer = timelineContainers[seriesIdx];
  if (!timelineContainer) return;

  const axis = timelineContainer.querySelector('.logic-timeline-axis');
  if (!axis) return;

  let cursor = axis.querySelector('.logic-timeline-cursor');
  if (!cursor) {
    cursor = document.createElement('div');
    cursor.className = 'logic-timeline-cursor';
    axis.appendChild(cursor);
  }

  // Calculate position based on elapsed time (40px per second)
  const seconds = elapsedMs / 1000;
  const leftPosition = seconds * 40;
  cursor.style.left = `${leftPosition}px`;
  cursor.style.display = "block";
}

// Remove chrono box on series_completed
export function handleSeriesCompleted(seriesIdx) {
  const timelineContainers = document.querySelectorAll('.logic-timeline-container');
  const timelineContainer = timelineContainers[seriesIdx];
  if (!timelineContainer) return;
  const axis = timelineContainer.querySelector('.logic-timeline-axis');
  if (!axis) return;
  const cursor = axis.querySelector('.logic-timeline-cursor');
  if (cursor) cursor.remove();
}