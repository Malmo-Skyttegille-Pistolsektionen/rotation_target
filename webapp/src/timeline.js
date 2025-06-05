
let currentSeriesIndex = null;
let currentEventIndex = null;
let timelineData = null;

export function renderTimeline(placeHolder, program) {
  console.log("Placeholder element:", placeHolder);
  console.log("Program data loaded:", program);

  placeHolder.innerHTML = "";

  timelineData = preprocess(program.series);

  timelineData.forEach((series, sIdx) => {
    const wrapper = document.createElement("div");
    wrapper.className = "series";
    if (series.optional) wrapper.classList.add("optional");
    wrapper.dataset.seriesIndex = sIdx;

    const title = document.createElement("div");
    title.textContent = series.name + (series.optional ? " (optional)" : "");
    wrapper.appendChild(title);

    const row = document.createElement("div");
    row.className = "events";

    series.events.forEach((ev, eIdx) => {
      const evDiv = document.createElement("div");
      evDiv.className = `event ${ev.symbolClass}`;
      evDiv.dataset.eventIndex = eIdx;

      const dur = document.createElement("div");
      dur.className = "dur";
      dur.textContent = ev.duration.toFixed(1);
      evDiv.appendChild(dur);

      const sym = document.createElement("div");
      sym.className = "symbol";
      sym.textContent = ev.symbolText;
      evDiv.appendChild(sym);

      const acc = document.createElement("div");
      acc.className = "acc";
      acc.textContent = ev.acc.toFixed(1);
      evDiv.appendChild(acc);

      row.appendChild(evDiv);
    });

    wrapper.appendChild(row);
    placeHolder.appendChild(wrapper);
  });
}

function preprocess(seriesList) {
  return seriesList.map((series) => {
    let acc = 0;
    const events = series.events.map(ev => {
      const duration = ev.duration / 10;

      // Determine the symbol class and text based on event properties
      let symbolClass = "no-action";
      let symbolText = "";

      if (ev.command === "show" && ev.audio_ids) {
        symbolClass = "show audio";
        symbolText = "A";
      } else if (ev.command === "hide" && ev.audio_ids) {
        symbolClass = "hide audio";
        symbolText = "A";
      } else if (ev.command === "show") {
        symbolClass = "show";
      } else if (ev.command === "hide") {
        symbolClass = "hide";
      } else if (ev.audio_ids) {
        symbolClass = "audio";
        symbolText = "A";
      }

      const entry = { ...ev, duration, acc, symbolClass, symbolText };
      acc += duration;
      return entry;
    });
    return { ...series, events };
  });
}

export function setCurrent(si, ei) {
  currentSeriesIndex = si;
  currentEventIndex = ei;

  document.querySelectorAll(".series").forEach(s => s.classList.remove("current"));
  document.querySelectorAll(".event").forEach(e => e.classList.remove("current"));

  const currentSeries = document.querySelector(`[data-series-index='${si}']`);
  if (currentSeries) {
    currentSeries.classList.add("current");
    const currentEvent = currentSeries.querySelector(`[data-event-index='${ei}']`);
    if (currentEvent) currentEvent.classList.add("current");
  }
}

export function clearCurrent() {
  currentSeriesIndex = null;
  currentEventIndex = null;
  document.querySelectorAll(".series").forEach(s => s.classList.remove("current"));
  document.querySelectorAll(".event").forEach(e => e.classList.remove("current"));
}

