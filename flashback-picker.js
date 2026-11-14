import { calendarDay } from './memory-engine.js';

const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC', calendar: 'gregory' });
const dayLabel = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeZone: 'UTC', calendar: 'gregory' });
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
const toDay = value => new Date(`${value}T00:00:00Z`);
const toISO = day => day.toISOString().slice(0, 10);

export function flashbackPicker(title, selected) {
    const root = document.createElement('div');
    root.className = 'sa-review sa-flashback-picker';
    root.innerHTML = `<h3 id="sa-flashback-title"></h3>
        <label class="sa-flashback-date"><span>Story date</span>
            <input class="text_pole" type="text" placeholder="YYYY-MM-DD" maxlength="10" autocomplete="off" spellcheck="false" required>
        </label>
        <div class="sa-flashback-month">
            <button type="button" data-month="previous" aria-label="Previous month"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
            <b id="sa-flashback-month" aria-live="polite"></b>
            <button type="button" data-month="next" aria-label="Next month"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
        </div>
        <div class="sa-flashback-weekdays" aria-hidden="true">${weekdays.map(day => `<span>${day}</span>`).join('')}</div>
        <div class="sa-flashback-days" role="group" aria-labelledby="sa-flashback-month"></div>`;
    root.querySelector('h3').textContent = title;
    const input = root.querySelector('input'), month = root.querySelector('#sa-flashback-month');
    const days = root.querySelector('.sa-flashback-days');
    const previous = root.querySelector('[data-month=previous]'), next = root.querySelector('[data-month=next]');
    const today = new Date();
    const date = () => input.value.trim();
    input.value = selected;
    let cursor = selected ? toDay(selected) : new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));

    function render() {
        const year = cursor.getUTCFullYear(), index = cursor.getUTCMonth();
        const first = new Date(Date.UTC(year, index, 1));
        const count = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
        const offset = (first.getUTCDay() + 6) % 7;
        const label = monthLabel.format(first), selectedDate = date();
        if (month.textContent !== label) month.textContent = label;
        // The story date parser accepts four-digit years starting at 0100.
        previous.disabled = year === 100 && index === 0;
        next.disabled = year === 9999 && index === 11;
        const buttons = [];
        for (let n = 1; n <= count; n++) {
            const day = new Date(Date.UTC(year, index, n));
            const iso = toISO(day), button = document.createElement('button');
            button.type = 'button';
            button.textContent = String(n);
            button.dataset.date = iso;
            button.setAttribute('aria-label', dayLabel.format(day));
            button.setAttribute('aria-pressed', String(selectedDate === iso));
            button.tabIndex = n === cursor.getUTCDate() ? 0 : -1;
            if (n === 1) button.style.gridColumnStart = String(offset + 1);
            buttons.push(button);
        }
        days.replaceChildren(...buttons);
    }

    function moveMonth(step) {
        cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + step, 1));
        render();
    }
    previous.addEventListener('click', () => moveMonth(-1));
    next.addEventListener('click', () => moveMonth(1));
    days.addEventListener('click', event => {
        const value = event.target.closest('[data-date]')?.dataset.date;
        if (!value) return;
        input.value = value;
        input.setCustomValidity('');
        cursor = toDay(value);
        render();
        days.querySelector('[tabindex="0"]').focus();
    });
    days.addEventListener('keydown', event => {
        const step = steps[event.key], value = event.target.dataset.date;
        if (!step || !value) return;
        event.preventDefault();
        event.stopPropagation();
        const day = toDay(value);
        day.setUTCDate(day.getUTCDate() + step);
        if (day.getUTCFullYear() < 100 || day.getUTCFullYear() > 9999) return;
        cursor = day;
        render();
        days.querySelector('[tabindex="0"]').focus();
    });
    input.addEventListener('input', () => {
        input.setCustomValidity('');
        const value = date();
        if (calendarDay(value) === value) cursor = toDay(value);
        render();
    });

    render();
    return { root, date, validate: () => {
        const value = date();
        input.setCustomValidity(calendarDay(value) === value ? '' : 'Pick a day or enter a valid date as YYYY-MM-DD.');
        return input.reportValidity();
    } };
}
