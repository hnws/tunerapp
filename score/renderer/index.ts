import { OpenSheetMusicDisplay, PointF2D } from "opensheetmusicdisplay";
import { applyAutomaticBeaming } from "./beamGrouping";
import { applyTimeSignatureCorrection } from "./timeSignatureCorrection";
import { createScoreCursor, type ScoreCursor } from "./scoreCursor";

export type { CursorNoteInfo, ScoreCursor, NoteHighlight } from "./scoreCursor";

export interface RenderedScoreHandle {
  unmount(): void;
  cursor: ScoreCursor;
  // Where each bar is drawn, in pixels relative to the container passed to renderScore -- for
  // tapping bars on the score (spot practice). Read fresh each time: OSMD re-lays out on resize.
  getMeasureBoxes(): MeasureBox[];
  // The note (or rest) nearest a click, in viewport coordinates (MouseEvent.clientX/Y), or null
  // when nothing is close. Its position is in quarter notes from the start of the piece -- the
  // same units as ScoreCursor.buildQuarterIndex(), so it can be matched against that index.
  noteAt(clientX: number, clientY: number): { quarter: number } | null;
  // Where to draw a marker for the staff entry at `quarter` (a thin column over its bar's staff,
  // relative to the container, like getMeasureBoxes), plus the printed bar number. Read fresh
  // after every re-layout.
  markerAt(quarter: number): StartMarkerBox | null;
}

export interface StartMarkerBox {
  barNumber: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

// How far from a note a click still counts as that note, in OSMD units (a staff is 4 units tall).
const NOTE_CLICK_TOLERANCE = new PointF2D(2.5, 5);
const QUARTER_EPSILON = 1e-6;

export interface MeasureBox {
  measureIndex: number;
  // The bar number printed on the sheet (differs from measureIndex + 1 when the file starts
  // mid-piece or leaves bars out).
  barNumber: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

// OSMD lays out in its own units: 10 px per unit at zoom 1.
const OSMD_UNIT_PX = 10;

export interface ScoreRenderOptions {
  drawTitle?: boolean;
  drawComposer?: boolean;
  // Title/composer resolved by importMusicXmlToScore's credit-ranking heuristic. When set,
  // these override whatever OSMD would otherwise pick from the same (often unreliable, for
  // HOMR-sourced XML) <work-title>/<credit> data, so the rendered score and the app's
  // metadata card never disagree.
  titleOverride?: string;
  composerOverride?: string;
  // Dev-only toggle (see src/App.tsx): when a measure's actual duration doesn't match its time
  // signature -- typically HOMR failing to detect a mid-piece meter change -- infer and insert a
  // corrected <time> for that single measure before OSMD renders it. Off by default; see
  // score/timeSignatureInference.ts for why the inference is inherently ambiguous.
  autoCorrectTimeSignatures?: boolean;
}

// Rewrites <work-title> and <identification><creator type="composer"> (creating either if
// absent) so OSMD's own title/composer-drawing logic picks up the already-resolved values
// instead of re-deriving its own from the same ambiguous page credits.
function applyMetadataOverrides(xml: string, title?: string, composer?: string): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    return xml;
  }

  if (title) {
    let work = doc.querySelector("work");
    if (!work) {
      work = doc.createElement("work");
      doc.documentElement.insertBefore(work, doc.documentElement.firstChild);
    }

    let workTitle = work.querySelector("work-title");
    if (!workTitle) {
      workTitle = doc.createElement("work-title");
      work.appendChild(workTitle);
    }
    workTitle.textContent = title;
  }

  if (composer) {
    let identification = doc.querySelector("identification");
    if (!identification) {
      identification = doc.createElement("identification");
      doc.documentElement.insertBefore(identification, doc.querySelector("part-list"));
    }

    let composerCreator = identification.querySelector('creator[type="composer"]');
    if (!composerCreator) {
      composerCreator = doc.createElement("creator");
      composerCreator.setAttribute("type", "composer");
      identification.appendChild(composerCreator);
    }
    composerCreator.textContent = composer;
  }

  return new XMLSerializer().serializeToString(doc);
}

// Removes <stem> from every <note> so setWantedStemDirectionByXml: false (set below) has
// nothing stale to ignore — OSMD then computes every stem direction automatically, which is
// beam-group-aware and enforces one consistent direction per beam once <beam> data (see
// applyAutomaticBeaming) correctly groups notes. Beam data itself is handled separately since
// OSMD's own automatic beaming isn't trustworthy enough to just fill gaps around — see
// beamGrouping.ts for why.
function stripStemHints(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    return xml;
  }

  for (const element of Array.from(doc.querySelectorAll("note > stem"))) {
    element.remove();
  }

  return new XMLSerializer().serializeToString(doc);
}

// Whether the source XML already carries its own <beam> data. OSMD's `autoBeam` option only
// fills gaps for notes with none at all -- and that fallback has been directly confirmed to fail
// outright on certain patterns (repeating pitches; see beamGrouping.ts), not just to be a rough
// approximation. So whenever the source has no beam data of its own, we compute correct beams
// ourselves instead of trusting autoBeam -- regardless of where the XML came from. This used to
// only run for OMR/photo-sourced scores (gated on sourceType, since HOMR output typically has no
// beam data), which silently meant a directly-uploaded MusicXML file lacking its own beam data
// (common -- many exporters omit it) rendered with OSMD's broken autoBeam instead. A file that
// DOES already carry real beam data (e.g. from real notation software) is left untouched.
function hasBeamData(xml: string): boolean {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    // Can't tell -- let OSMD's own parse (and error handling) be the source of truth rather than
    // rewriting XML we couldn't even parse ourselves.
    return true;
  }
  return doc.querySelector("note > beam") !== null;
}

// Renders directly from the raw MusicXML text via OpenSheetMusicDisplay (OSMD) rather than
// through the app's internal ScoreDocument reduction. ScoreDocument drops rests, ties, slurs,
// articulations, and dynamics entirely (it only tracks pitched notes for score-following), so
// building notation from it can never be fidelity-complete regardless of which layout engine
// draws it. OSMD parses the source XML itself, so all of that survives.
export async function renderScore(
  xmlData: string,
  container: HTMLDivElement,
  options: ScoreRenderOptions = {}
): Promise<RenderedScoreHandle> {
  container.innerHTML = "";

  const osmd = new OpenSheetMusicDisplay(container, {
    autoResize: true,
    backend: "svg",
    autoBeam: true,
    setWantedStemDirectionByXml: false,
    drawTitle: options.drawTitle ?? true,
    drawComposer: options.drawComposer ?? true,
    onXMLRead: (xml: string) => {
      const withMetadata = applyMetadataOverrides(xml, options.titleOverride, options.composerOverride);
      // Applied before the beam-data check below so any measure-level correction is what
      // applyAutomaticBeaming (if it runs) computes beat groupings from -- otherwise a corrected
      // meter could still get beamed as if it were the original, wrong one.
      const withTimeSignatures = options.autoCorrectTimeSignatures ? applyTimeSignatureCorrection(withMetadata) : withMetadata;
      if (hasBeamData(withTimeSignatures)) {
        return withTimeSignatures;
      }
      return applyAutomaticBeaming(stripStemHints(withTimeSignatures));
    }
  });

  await osmd.load(xmlData);
  osmd.render();

  // Pass an accessor, not osmd.cursor's current value -- OSMD's render() (called via redraw()
  // below) silently replaces osmd.cursor with a brand-new Cursor instance every time
  // (OpenSheetMusicDisplay.enableOrDisableCursors()), so a snapshot taken once here would go
  // stale the first time highlightNotes() redraws. See the long comment in createScoreCursor().
  //
  // renderAndScrollBack() rather than plain render() -- highlightNotes() calls this after
  // practice ends to pick up NoteheadColor changes, and a plain render() would jump the page
  // scroll position back to the top of the sheet at that moment.
  const cursor = createScoreCursor(() => osmd.cursor, () => osmd.renderAndScrollBack());
  cursor.hide();

  return {
    cursor,
    getMeasureBoxes() {
      const svg = container.querySelector("svg");
      if (!svg || !osmd.GraphicSheet) return [];
      const svgRect = svg.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const offsetX = svgRect.left - containerRect.left;
      const offsetY = svgRect.top - containerRect.top;
      const scale = OSMD_UNIT_PX * osmd.zoom;
      const boxes: MeasureBox[] = [];
      osmd.GraphicSheet.MeasureList.forEach((staves, measureIndex) => {
        // One box per bar spanning all its staves (a single violin staff in practice).
        const shapes = staves.filter((measure) => measure?.PositionAndShape).map((measure) => measure.PositionAndShape);
        if (shapes.length === 0) return;
        const left = Math.min(...shapes.map((b) => b.AbsolutePosition.x + b.BorderLeft));
        const right = Math.max(...shapes.map((b) => b.AbsolutePosition.x + b.BorderRight));
        // A bar's own box covers just its staff lines; extend a little so notes above/below the
        // staff are tappable too.
        const top = Math.min(...shapes.map((b) => b.AbsolutePosition.y + b.BorderTop)) - 2;
        const bottom = Math.max(...shapes.map((b) => b.AbsolutePosition.y + b.BorderBottom)) + 2;
        boxes.push({
          measureIndex,
          barNumber: staves.find((measure) => measure?.parentSourceMeasure)?.parentSourceMeasure.getPrintedMeasureNumber() ?? measureIndex + 1,
          left: offsetX + left * scale,
          top: offsetY + top * scale,
          width: (right - left) * scale,
          height: (bottom - top) * scale
        });
      });
      return boxes;
    },
    noteAt(clientX, clientY) {
      const sheet = osmd.GraphicSheet;
      if (!sheet) return null;
      // DOM (client) -> SVG user space -> OSMD units, OSMD's own conversion helpers.
      const point = sheet.svgToOsmd(sheet.domToSvg(new PointF2D(clientX, clientY)));
      const note = sheet.GetNearestNote(point, NOTE_CLICK_TOLERANCE);
      const timestamp = note?.sourceNote?.getAbsoluteTimestamp();
      return timestamp ? { quarter: timestamp.RealValue * 4 } : null;
    },
    markerAt(quarter) {
      const svg = container.querySelector("svg");
      const sheet = osmd.GraphicSheet;
      if (!svg || !sheet) return null;
      const svgRect = svg.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const scale = OSMD_UNIT_PX * osmd.zoom;
      for (const staves of sheet.MeasureList) {
        for (const measure of staves) {
          if (!measure?.PositionAndShape) continue;
          const entry = measure.staffEntries.find(
            (candidate) => Math.abs(candidate.getAbsoluteTimestamp().RealValue * 4 - quarter) < QUARTER_EPSILON
          );
          if (!entry) continue;
          const bar = measure.PositionAndShape;
          const x = entry.PositionAndShape.AbsolutePosition.x;
          const top = bar.AbsolutePosition.y + bar.BorderTop - 2;
          const bottom = bar.AbsolutePosition.y + bar.BorderBottom + 2;
          return {
            // The number printed on the sheet (a practice file can start at bar 23), not OSMD's count.
            barNumber: measure.parentSourceMeasure.getPrintedMeasureNumber(),
            left: svgRect.left - containerRect.left + (x - 1.2) * scale,
            top: svgRect.top - containerRect.top + top * scale,
            width: 2.4 * scale,
            height: (bottom - top) * scale
          };
        }
      }
      return null;
    },
    unmount() {
      osmd.clear();
      container.innerHTML = "";
    }
  };
}
