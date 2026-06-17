import {type Writable} from 'node:stream';
import ansiEscapes from 'ansi-escapes';
import cliCursor from 'cli-cursor';
import {
	type CursorPosition,
	cursorPositionChanged,
	buildCursorSuffix,
	buildCursorOnlySequence,
	buildReturnToBottomPrefix,
	hideCursorEscape,
} from './cursor-helpers.js';

export type {CursorPosition} from './cursor-helpers.js';

export type LogUpdate = {
	clear: () => void;
	done: () => void;
	reset: () => void;
	sync: (str: string) => void;
	setCursorPosition: (position: CursorPosition | undefined) => void;
	isCursorDirty: () => boolean;
	willRender: (str: string) => boolean;
	(str: string): boolean;
};

// Count visible lines in a string, ignoring the trailing empty element
// that `split('\n')` produces when the string ends with '\n'.
const visibleLineCount = (lines: string[], str: string): number =>
	str.endsWith('\n') ? lines.length - 1 : lines.length;

const createStandard = (
	stream: Writable,
	{showCursor = false} = {},
): LogUpdate => {
	let previousLineCount = 0;
	let previousOutput = '';
	let hasHiddenCursor = false;
	let cursorPosition: CursorPosition | undefined;
	let cursorDirty = false;
	let previousCursorPosition: CursorPosition | undefined;
	let cursorWasShown = false;

	const getActiveCursor = () => (cursorDirty ? cursorPosition : undefined);
	const hasChanges = (
		str: string,
		activeCursor: CursorPosition | undefined,
	): boolean => {
		const cursorChanged = cursorPositionChanged(
			activeCursor,
			previousCursorPosition,
		);
		return str !== previousOutput || cursorChanged;
	};

	const render = (str: string) => {
		if (!showCursor && !hasHiddenCursor) {
			cliCursor.hide(stream);
			hasHiddenCursor = true;
		}

		// Only use cursor if setCursorPosition was called since last render.
		// This ensures stale positions don't persist after component unmount.
		const activeCursor = getActiveCursor();
		cursorDirty = false;
		const cursorChanged = cursorPositionChanged(
			activeCursor,
			previousCursorPosition,
		);

		if (!hasChanges(str, activeCursor)) {
			return false;
		}

		const lines = str.split('\n');
		const visibleCount = visibleLineCount(lines, str);
		const cursorSuffix = buildCursorSuffix(visibleCount, activeCursor);

		if (str === previousOutput && cursorChanged) {
			stream.write(
				buildCursorOnlySequence({
					cursorWasShown,
					previousLineCount,
					previousCursorPosition,
					visibleLineCount: visibleCount,
					cursorPosition: activeCursor,
				}),
			);
		} else {
			previousOutput = str;
			const returnPrefix = buildReturnToBottomPrefix(
				cursorWasShown,
				previousLineCount,
				previousCursorPosition,
			);
			stream.write(
				returnPrefix +
					ansiEscapes.eraseLines(previousLineCount) +
					str +
					cursorSuffix,
			);
			previousLineCount = lines.length;
		}

		previousCursorPosition = activeCursor ? {...activeCursor} : undefined;
		cursorWasShown = activeCursor !== undefined;
		return true;
	};

	render.clear = () => {
		const prefix = buildReturnToBottomPrefix(
			cursorWasShown,
			previousLineCount,
			previousCursorPosition,
		);
		stream.write(prefix + ansiEscapes.eraseLines(previousLineCount));
		previousOutput = '';
		previousLineCount = 0;
		previousCursorPosition = undefined;
		cursorWasShown = false;
	};

	render.done = () => {
		previousOutput = '';
		previousLineCount = 0;
		previousCursorPosition = undefined;
		cursorWasShown = false;

		if (!showCursor) {
			cliCursor.show(stream);
			hasHiddenCursor = false;
		}
	};

	render.reset = () => {
		previousOutput = '';
		previousLineCount = 0;
		previousCursorPosition = undefined;
		cursorWasShown = false;
	};

	render.sync = (str: string) => {
		const activeCursor = cursorDirty ? cursorPosition : undefined;
		cursorDirty = false;

		const lines = str.split('\n');
		previousOutput = str;
		previousLineCount = lines.length;

		if (!activeCursor && cursorWasShown) {
			stream.write(hideCursorEscape);
		}

		if (activeCursor) {
			stream.write(
				buildCursorSuffix(visibleLineCount(lines, str), activeCursor),
			);
		}

		previousCursorPosition = activeCursor ? {...activeCursor} : undefined;
		cursorWasShown = activeCursor !== undefined;
	};

	render.setCursorPosition = (position: CursorPosition | undefined) => {
		cursorPosition = position;
		cursorDirty = true;
	};

	render.isCursorDirty = () => cursorDirty;
	render.willRender = (str: string) => hasChanges(str, getActiveCursor());

	return render;
};

const createIncremental = (
	stream: Writable,
	{showCursor = false} = {},
): LogUpdate => {
	let previousLines: string[] = [];
	let previousOutput = '';
	let hasHiddenCursor = false;
	let cursorPosition: CursorPosition | undefined;
	let cursorDirty = false;
	let previousCursorPosition: CursorPosition | undefined;
	let cursorWasShown = false;

	const getActiveCursor = () => (cursorDirty ? cursorPosition : undefined);
	const hasChanges = (
		str: string,
		activeCursor: CursorPosition | undefined,
	): boolean => {
		const cursorChanged = cursorPositionChanged(
			activeCursor,
			previousCursorPosition,
		);
		return str !== previousOutput || cursorChanged;
	};

	const render = (str: string) => {
		if (!showCursor && !hasHiddenCursor) {
			cliCursor.hide(stream);
			hasHiddenCursor = true;
		}

		// Only use cursor if setCursorPosition was called since last render.
		// This ensures stale positions don't persist after component unmount.
		const activeCursor = getActiveCursor();
		cursorDirty = false;
		const cursorChanged = cursorPositionChanged(
			activeCursor,
			previousCursorPosition,
		);

		if (!hasChanges(str, activeCursor)) {
			return false;
		}

		const nextLines = str.split('\n');
		const visibleCount = visibleLineCount(nextLines, str);
		const previousVisible = visibleLineCount(previousLines, previousOutput);

		if (str === previousOutput && cursorChanged) {
			stream.write(
				buildCursorOnlySequence({
					cursorWasShown,
					previousLineCount: previousLines.length,
					previousCursorPosition,
					visibleLineCount: visibleCount,
					cursorPosition: activeCursor,
				}),
			);
			previousCursorPosition = activeCursor ? {...activeCursor} : undefined;
			cursorWasShown = activeCursor !== undefined;
			return true;
		}

		const returnPrefix = buildReturnToBottomPrefix(
			cursorWasShown,
			previousLines.length,
			previousCursorPosition,
		);

		if (str === '\n' || previousOutput.length === 0) {
			const cursorSuffix = buildCursorSuffix(visibleCount, activeCursor);
			stream.write(
				returnPrefix +
					ansiEscapes.eraseLines(previousLines.length) +
					str +
					cursorSuffix,
			);
			cursorWasShown = activeCursor !== undefined;
			previousCursorPosition = activeCursor ? {...activeCursor} : undefined;
			previousOutput = str;
			previousLines = nextLines;
			return true;
		}

		const hasTrailingNewline = str.endsWith('\n');

		// We aggregate all chunks for incremental rendering into a buffer, and then write them to stdout at the end.
		const buffer: string[] = [];

		buffer.push(returnPrefix);

		// Position the cursor at row 0 of the previous output area so the
		// diff loop's i-th iteration aligns with row i. When the previous
		// output ends with '\n' the cursor sits one row below the last
		// visible content (on the empty row that the trailing newline
		// produced), so it must come up by `previousVisible` rows; with no
		// trailing newline it sits on the last visible content row, so it
		// must come up by `previousVisible - 1` rows. The shrink branch
		// already accounts for this via `extraSlot` on `eraseLines`; the
		// grow/same branch had been using `previousVisible - 1`
		// unconditionally, which left the diff loop writing one row too
		// low and corrupting the rendered region whenever the output had
		// a trailing newline.
		const previousHadTrailingNewline = previousOutput.endsWith('\n');
		if (visibleCount < previousVisible) {
			const extraSlot = previousHadTrailingNewline ? 1 : 0;
			buffer.push(
				ansiEscapes.eraseLines(previousVisible - visibleCount + extraSlot),
				ansiEscapes.cursorUp(visibleCount),
			);
		} else {
			const upCount = previousHadTrailingNewline
				? previousVisible
				: previousVisible - 1;
			if (upCount > 0) {
				buffer.push(ansiEscapes.cursorUp(upCount));
			}
		}

		for (let i = 0; i < visibleCount; i++) {
			const isLastLine = i === visibleCount - 1;

			// We do not write lines if the contents are the same. This prevents flickering during renders.
			if (nextLines[i] === previousLines[i]) {
				// Don't move past the last line when there's no trailing newline,
				// otherwise the cursor overshoots the rendered block.
				if (!isLastLine || hasTrailingNewline) {
					buffer.push(ansiEscapes.cursorNextLine);
				}

				continue;
			}

			// Erase the row BEFORE writing the new content. If we instead
			// erase after the write, the cursor is in pending-wrap state
			// when the new content fills the terminal width (writing at the
			// last column leaves the cursor logically at that column rather
			// than advancing past it). On xterm-style terminals — including
			// Terminal.app and iTerm2 — `\e[K` in pending-wrap state erases
			// the just-written character, corrupting the rightmost cell on
			// every redraw. Erasing first is safe in both directions: when
			// the new content is shorter, the row clears before the new
			// content writes (no residue); when the new content fills the
			// width, no erase happens at the right edge so the last column
			// survives. The two operations are streamed together so the
			// terminal renders them as a single frame — there is no visible
			// intermediate "blank row" state.
			buffer.push(
				ansiEscapes.cursorTo(0) +
					ansiEscapes.eraseEndLine +
					nextLines[i] +
					// Don't append newline after the last line when the input
					// has no trailing newline (fullscreen mode).
					(isLastLine && !hasTrailingNewline ? '' : '\n'),
			);
		}

		const cursorSuffix = buildCursorSuffix(visibleCount, activeCursor);
		buffer.push(cursorSuffix);

		stream.write(buffer.join(''));

		cursorWasShown = activeCursor !== undefined;
		previousCursorPosition = activeCursor ? {...activeCursor} : undefined;
		previousOutput = str;
		previousLines = nextLines;
		return true;
	};

	render.clear = () => {
		const prefix = buildReturnToBottomPrefix(
			cursorWasShown,
			previousLines.length,
			previousCursorPosition,
		);
		stream.write(prefix + ansiEscapes.eraseLines(previousLines.length));
		previousOutput = '';
		previousLines = [];
		previousCursorPosition = undefined;
		cursorWasShown = false;
	};

	render.done = () => {
		previousOutput = '';
		previousLines = [];
		previousCursorPosition = undefined;
		cursorWasShown = false;

		if (!showCursor) {
			cliCursor.show(stream);
			hasHiddenCursor = false;
		}
	};

	render.reset = () => {
		previousOutput = '';
		previousLines = [];
		previousCursorPosition = undefined;
		cursorWasShown = false;
	};

	render.sync = (str: string) => {
		const activeCursor = cursorDirty ? cursorPosition : undefined;
		cursorDirty = false;

		const lines = str.split('\n');
		previousOutput = str;
		previousLines = lines;

		if (!activeCursor && cursorWasShown) {
			stream.write(hideCursorEscape);
		}

		if (activeCursor) {
			stream.write(
				buildCursorSuffix(visibleLineCount(lines, str), activeCursor),
			);
		}

		previousCursorPosition = activeCursor ? {...activeCursor} : undefined;
		cursorWasShown = activeCursor !== undefined;
	};

	render.setCursorPosition = (position: CursorPosition | undefined) => {
		cursorPosition = position;
		cursorDirty = true;
	};

	render.isCursorDirty = () => cursorDirty;
	render.willRender = (str: string) => hasChanges(str, getActiveCursor());

	return render;
};

const create = (
	stream: Writable,
	{showCursor = false, incremental = false} = {},
): LogUpdate => {
	if (incremental) {
		return createIncremental(stream, {showCursor});
	}

	return createStandard(stream, {showCursor});
};

const logUpdate = {create};
export default logUpdate;
