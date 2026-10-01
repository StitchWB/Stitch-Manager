"""FWCIM-совместимый ввод: события клавиатуры и мыши для BehaviorSpoofModule."""

import random
import time
from typing import cast


class BehaviorFwcimMixin:
    """FWCIM-совместимые события ввода (keydown/keyup, mousedown/mouseup, focus)."""

    def fwcim_type(self, page, element, text: str, field_type: str = 'default', fast: bool = False):
        """
        Печатает текст с генерацией правильных событий для FWCIM.

        FWCIM собирает:
        - keyCycles: [{startEventTime, endEventTime, which}, ...] - время удержания клавиши
        - keyPressTimeIntervals: время между нажатиями
        - keyPresses: количество нажатий

        Args:
            page: DrissionPage instance
            element: Элемент для ввода
            text: Текст для ввода
            field_type: Тип поля ('email', 'password', 'name', 'code', 'default')
            fast: Быстрый режим (меньше задержек, но всё ещё генерирует события)
        """
        # Получаем настройки для типа поля
        field_config = self.FIELD_SPEEDS.get(field_type, self.FIELD_SPEEDS['default'])
        delay_range: tuple[float, float] = cast(tuple[float, float], field_config['delay'])

        # В быстром режиме уменьшаем задержки
        if fast:
            delay_range = (0.01, 0.03)

        # Пауза "на подумать" перед вводом (только в медленном режиме)
        if not fast and field_type in ('password', 'code'):
            self.think_before_typing(field_type)

        # Фокус на элементе с правильными событиями
        self.fwcim_focus(page, element)
        time.sleep(random.uniform(0.05, 0.1) if fast else random.uniform(0.1, 0.2))

        # Очищаем поле через select + delete (работает с React)
        page.run_js('''
            const el = arguments[0];
            try {
                if (el.select && typeof el.select === 'function') {
                    el.select();
                } else if (el.setSelectionRange && typeof el.setSelectionRange === 'function') {
                    el.focus();
                    el.setSelectionRange(0, el.value.length);
                } else {
                    el.focus();
                }
            } catch (e) {
                console.log('Select failed, using focus:', e);
                el.focus();
            }
        ''', element)
        time.sleep(0.02)

        # Генерируем Delete/Backspace для очистки (FWCIM видит это)
        page.run_js('''
            const el = arguments[0];
            if (el.value) {
                el.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Delete', code: 'Delete', keyCode: 46, which: 46, bubbles: true
                }));
                el.value = '';
                el.dispatchEvent(new InputEvent('input', {
                    inputType: 'deleteContentBackward', bubbles: true
                }));
                el.dispatchEvent(new KeyboardEvent('keyup', {
                    key: 'Delete', code: 'Delete', keyCode: 46, which: 46, bubbles: true
                }));
            }
        ''', element)
        time.sleep(0.02)

        for i, char in enumerate(text):
            # Случайная пауза "на подумать" в середине ввода (только в медленном режиме)
            if not fast and random.random() < 0.03 and i > 0 and i < len(text) - 1:
                time.sleep(random.uniform(0.3, 0.8))

            # Генерируем keydown -> keypress -> input -> keyup
            self._dispatch_key_events(page, element, char, fast=fast)

            # Задержка между символами (inter-key interval)
            delay = random.uniform(*delay_range)

            # Дополнительная пауза после определённых символов (только в медленном режиме)
            if not fast:
                if char in '.,!?@':
                    delay += random.uniform(0.1, 0.3)
                elif char == ' ':
                    delay += random.uniform(0.05, 0.15)

            time.sleep(delay)

    def _dispatch_key_events(self, page, element, char: str, fast: bool = False):
        """
        Генерирует полную последовательность событий клавиши для FWCIM.

        Последовательность: keydown -> (hold time) -> keyup
        FWCIM записывает startEventTime (keydown) и endEventTime (keyup)

        ВАЖНО: Использует нативный setter для совместимости с React!
        """
        # Время удержания клавиши (50-150ms для обычного набора, меньше в быстром режиме)
        hold_time = random.uniform(0.02, 0.05) if fast else random.uniform(0.05, 0.15)

        # Получаем keyCode для символа
        key_code = ord(char.upper()) if char.isalpha() else ord(char)

        # Определяем правильный code для клавиши
        if char.isalpha():
            code = f'Key{char.upper()}'
        elif char.isdigit():
            code = f'Digit{char}'
        elif char == ' ':
            code = 'Space'
        elif char == '@':
            code = 'Digit2'  # Shift+2 на US keyboard
        elif char == '.':
            code = 'Period'
        elif char == '-':
            code = 'Minus'
        elif char == '_':
            code = 'Minus'  # Shift+Minus
        else:
            code = f'Key{char}'

        # keydown + keypress + input (всё в одном JS вызове для атомарности)
        page.run_js('''
            const el = arguments[0];
            const char = arguments[1];
            const keyCode = arguments[2];
            const code = arguments[3];

            // keydown
            el.dispatchEvent(new KeyboardEvent('keydown', {
                key: char,
                code: code,
                keyCode: keyCode,
                which: keyCode,
                bubbles: true,
                cancelable: true
            }));

            // keypress (deprecated but FWCIM may still listen)
            el.dispatchEvent(new KeyboardEvent('keypress', {
                key: char,
                charCode: char.charCodeAt(0),
                keyCode: keyCode,
                which: keyCode,
                bubbles: true,
                cancelable: true
            }));

            // КРИТИЧНО: Используем нативный setter для React-совместимости
            // React перехватывает setter и обновляет state
            try {
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype, 'value'
                ).set;
                if (nativeInputValueSetter) {
                    nativeInputValueSetter.call(el, el.value + char);
                } else {
                    // Fallback: прямое изменение value
                    el.value = el.value + char;
                }
            } catch (e) {
                console.log('Native setter failed, using direct assignment:', e);
                // Fallback: прямое изменение value
                el.value = el.value + char;
            }

            // Input event (React слушает это)
            el.dispatchEvent(new InputEvent('input', {
                data: char,
                inputType: 'insertText',
                bubbles: true,
                cancelable: true
            }));
        ''', element, char, key_code, code)

        # Hold time (FWCIM measures this!)
        time.sleep(hold_time)

        # keyup event
        page.run_js('''
            const el = arguments[0];
            const char = arguments[1];
            const keyCode = arguments[2];
            const code = arguments[3];

            el.dispatchEvent(new KeyboardEvent('keyup', {
                key: char,
                code: code,
                keyCode: keyCode,
                which: keyCode,
                bubbles: true,
                cancelable: true
            }));
        ''', element, char, key_code, code)

    def fwcim_click(self, page, element):
        """
        Кликает с генерацией правильных событий для FWCIM.

        FWCIM собирает:
        - mouseCycles: [{startEventTime, endEventTime}, ...] - время удержания клика
        - mouseClickPositions: позиции кликов
        - clicks: количество кликов
        """
        # Время удержания кнопки мыши (80-200ms для обычного клика)
        hold_time = random.uniform(0.08, 0.2)

        # Получаем позицию элемента для реалистичного клика
        try:
            rect = page.run_js('''
                const el = arguments[0];
                const rect = el.getBoundingClientRect();
                // Случайная позиция внутри элемента
                return {
                    x: rect.left + rect.width * (0.3 + Math.random() * 0.4),
                    y: rect.top + rect.height * (0.3 + Math.random() * 0.4)
                };
            ''', element)

            client_x = int(rect['x'])
            client_y = int(rect['y'])
        except Exception:
            client_x = 400
            client_y = 300

        # mousedown event
        page.run_js('''
            const el = arguments[0];
            const x = arguments[1];
            const y = arguments[2];

            el.dispatchEvent(new MouseEvent('mousedown', {
                clientX: x,
                clientY: y,
                button: 0,
                buttons: 1,
                bubbles: true,
                cancelable: true
            }));
        ''', element, client_x, client_y)

        # Hold time (FWCIM measures this!)
        time.sleep(hold_time)

        # mouseup event
        page.run_js('''
            const el = arguments[0];
            const x = arguments[1];
            const y = arguments[2];

            el.dispatchEvent(new MouseEvent('mouseup', {
                clientX: x,
                clientY: y,
                button: 0,
                buttons: 0,
                bubbles: true,
                cancelable: true
            }));

            // click event (follows mouseup)
            el.dispatchEvent(new MouseEvent('click', {
                clientX: x,
                clientY: y,
                button: 0,
                bubbles: true,
                cancelable: true
            }));
        ''', element, client_x, client_y)

    def fwcim_focus(self, page, element):
        """
        Фокусируется на элементе с правильными событиями для FWCIM.

        FWCIM отслеживает:
        - firstFocusTime: время первого фокуса
        - totalFocusTime: общее время фокуса
        """
        page.run_js('''
            const el = arguments[0];

            // focusin event (bubbles)
            el.dispatchEvent(new FocusEvent('focusin', {
                bubbles: true,
                cancelable: false
            }));

            // focus event (doesn't bubble)
            el.dispatchEvent(new FocusEvent('focus', {
                bubbles: false,
                cancelable: false
            }));

            // Actually focus the element
            el.focus();
        ''', element)
