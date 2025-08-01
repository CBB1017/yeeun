import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { columnWidths } from "$lib/column-store";
import { get } from "svelte/store";
import { tick } from "svelte";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, "child"> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
export function debounce<T extends (...args: any[]) => void>(fn: T, delay = 300) {
	let timer: ReturnType<typeof setTimeout> | null;
	return (...args: Parameters<T>) => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => fn(...args), delay);
	};
}

export const handleResizeStart = (
	e: MouseEvent,
	col: string,
	onResizeEnd: () => void
) => {
	e.preventDefault();
	e.stopPropagation();

	const startX = e.clientX;
	const startWidth = get(columnWidths)[col] || 120;

	function onMouseMove ( ev: MouseEvent ) {
		const delta = ev.clientX - startX;
		columnWidths.update( current => ({ ...current, [col]: Math.max( 60, startWidth + delta ) }) );
	}

	function onMouseUp () {
		window.removeEventListener( "mousemove", onMouseMove );
		window.removeEventListener( "mouseup", onMouseUp );

		// 리사이즈 완료 후 tooltip 상태 업데이트
		setTimeout(() => {
			onResizeEnd();
		}, 0);
	}

	window.addEventListener( "mousemove", onMouseMove );
	window.addEventListener( "mouseup", onMouseUp );
}

function isEllipsed ( el: HTMLElement | null ): boolean {
	if ( !el ) return false;
	return el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth;
}
export async function checkEllipsed (container: HTMLElement | null): Promise<boolean> {
	await tick();
	return isEllipsed( container );
}