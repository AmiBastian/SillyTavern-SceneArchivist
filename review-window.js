// Keep SillyTavern's modal review and keyboard handling while exposing the chat beside it.
export function addReviewHandle(root, dialog) {
    if (!root.classList.contains('sa-review') || !root.querySelector('textarea')) return;
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'sa-review-handle';
    handle.textContent = '↔️ Move review';
    handle.title = 'Drag or use arrow keys to move the review. Enter restores the center.';
    root.prepend(handle);
    let drag = null;
    const move = (left, top) => {
        dialog.classList.add('sa-floating-review');
        const rect = dialog.getBoundingClientRect();
        dialog.style.left = Math.max(4, Math.min(innerWidth - rect.width - 4, left)) + 'px';
        dialog.style.top = Math.max(4, Math.min(innerHeight - rect.height - 4, top)) + 'px';
    };
    handle.addEventListener('pointerdown', event => {
        if (!matchMedia('(min-width: 801px)').matches || event.button !== 0) return;
        const rect = dialog.getBoundingClientRect();
        drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
        if (drag) move(event.clientX - drag.x, event.clientY - drag.y);
    });
    handle.addEventListener('lostpointercapture', () => { drag = null; });
    handle.addEventListener('click', () => {
        if (dialog.classList.contains('sa-floating-review')) {
            const rect = dialog.getBoundingClientRect();
            move(rect.left, rect.top);
        } else {
            move(innerWidth - 650, 24);
        }
    });
    handle.addEventListener('keydown', event => {
        const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        if (!direction && event.key !== 'Enter') return;
        event.preventDefault();
        if (event.key === 'Enter') {
            dialog.classList.remove('sa-floating-review');
            dialog.style.removeProperty('top'); dialog.style.removeProperty('left');
        } else {
            const rect = dialog.getBoundingClientRect();
            move(rect.left + direction[0] * 24, rect.top + direction[1] * 24);
        }
    });
}
