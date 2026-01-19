"""
Модуль для имитации человеческого поведения

Это Python-модуль (не JS!) для реалистичного взаимодействия с браузером.
Используется для обхода поведенческого анализа AWS FWCIM.

Особенности:
- Случайные опечатки и исправления
- Паузы "на подумать" перед вводом
- Разная скорость для разных типов полей
- Реалистичные движения мыши по кривой Безье
"""

import random
import time
import string
from typing import Optional, Tuple, cast


class BehaviorSpoofModule:
    """
    Имитация человеческого поведения при взаимодействии с браузером.
    
    Использование:
        behavior = BehaviorSpoofModule()
        behavior.human_delay()  # Пауза между действиями
        behavior.human_type(element, "text", field_type="email")  # Печать с задержками
    """
    
    name = "behavior"
    description = "Human-like behavior simulation (Python)"
    
    # Типы полей и их характеристики скорости
    FIELD_SPEEDS = {
        'email': {'delay': (0.03, 0.08), 'typo_prob': 0.01},      # Email - быстро, мало ошибок (знакомый текст)
        'password': {'delay': (0.08, 0.18), 'typo_prob': 0.0},    # Пароль - медленнее, БЕЗ опечаток (критично!)
        'name': {'delay': (0.05, 0.12), 'typo_prob': 0.01},       # Имя - средняя скорость
        'code': {'delay': (0.12, 0.25), 'typo_prob': 0.0},        # Код верификации - БЕЗ опечаток!
        'default': {'delay': (0.05, 0.15), 'typo_prob': 0.01}     # По умолчанию
    }
    
    # Соседние клавиши для реалистичных опечаток
    NEARBY_KEYS = {
        'q': 'wa', 'w': 'qeas', 'e': 'wrsd', 'r': 'etdf', 't': 'ryfg',
        'y': 'tugh', 'u': 'yihj', 'i': 'uojk', 'o': 'iplk', 'p': 'ol',
        'a': 'qwsz', 's': 'awedxz', 'd': 'serfcx', 'f': 'drtgvc', 'g': 'ftyhbv',
        'h': 'gyujnb', 'j': 'huikmn', 'k': 'jiolm', 'l': 'kop',
        'z': 'asx', 'x': 'zsdc', 'c': 'xdfv', 'v': 'cfgb', 'b': 'vghn',
        'n': 'bhjm', 'm': 'njk',
        '1': '2q', '2': '13qw', '3': '24we', '4': '35er', '5': '46rt',
        '6': '57ty', '7': '68yu', '8': '79ui', '9': '80io', '0': '9p'
    }
    
    def __init__(self):
        # Настройки задержек
        self.typing_delay_range = (0.05, 0.15)      # Между символами
        self.action_delay_range = (0.3, 1.0)        # Между действиями
        self.think_delay_range = (0.5, 2.0)         # "Думает" перед действием
        
        # Вероятности
        self.typo_probability = 0.02                # Вероятность опечатки
        self.pause_probability = 0.1                # Вероятность паузы при печати
        
        # Статистика сессии (для более реалистичного поведения)
        self._chars_typed = 0
        self._typos_made = 0
        self._session_start = time.time()
    
    def human_delay(self, min_delay: Optional[float] = None, max_delay: Optional[float] = None):
        """Человеческая задержка между действиями"""
        min_d = min_delay or self.action_delay_range[0]
        max_d = max_delay or self.action_delay_range[1]
        time.sleep(random.uniform(min_d, max_d))
    
    def think_delay(self):
        """Задержка "размышления" перед действием"""
        time.sleep(random.uniform(*self.think_delay_range))
    
    def typing_delay(self):
        """Задержка между нажатиями клавиш"""
        delay = random.uniform(*self.typing_delay_range)
        
        # Иногда делаем паузу
        if random.random() < self.pause_probability:
            delay += random.uniform(0.3, 0.8)
        
        time.sleep(delay)
    
    def simulate_reading(self, duration: Optional[float] = None):
        """Симулирует чтение страницы"""
        if duration is None:
            duration = random.uniform(1.0, 3.0)
        time.sleep(duration)
    
    def human_type(self, element, text: str, clear_first: bool = True, field_type: str = 'default'):
        """
        Печатает текст с человеческими задержками.
        
        Args:
            element: Элемент для ввода (DrissionPage element)
            text: Текст для ввода
            clear_first: Очистить поле перед вводом
            field_type: Тип поля ('email', 'password', 'name', 'code', 'default')
        """
        # Получаем настройки для типа поля
        field_config = self.FIELD_SPEEDS.get(field_type, self.FIELD_SPEEDS['default'])
        delay_range: Tuple[float, float] = cast(Tuple[float, float], field_config['delay'])
        typo_prob: float = cast(float, field_config['typo_prob'])
        
        # Пауза "на подумать" перед вводом (особенно для паролей и кодов)
        if field_type in ('password', 'code'):
            self.think_before_typing(field_type)
        
        element.click()
        self.human_delay(0.1, 0.3)
        
        if clear_first:
            element.clear()
            self.human_delay(0.1, 0.2)
        
        i = 0
        while i < len(text):
            char = text[i]
            
            # Случайная пауза "на подумать" в середине ввода
            if random.random() < 0.03 and i > 0 and i < len(text) - 1:
                time.sleep(random.uniform(0.3, 0.8))
            
            # Опечатка с реалистичным исправлением
            if random.random() < typo_prob and i < len(text) - 1:
                typo_char = self._get_typo_char(char)
                if typo_char:
                    element.input(typo_char)
                    self._chars_typed += 1
                    self._typos_made += 1
                    
                    # Задержка перед осознанием ошибки
                    time.sleep(random.uniform(0.1, 0.4))
                    
                    # Иногда печатаем ещё 1-2 символа перед исправлением
                    extra_chars = 0
                    if random.random() < 0.3 and i + 1 < len(text):
                        extra_chars = random.randint(1, min(2, len(text) - i - 1))
                        for j in range(extra_chars):
                            element.input(text[i + 1 + j])
                            time.sleep(random.uniform(*delay_range))
                    
                    # Пауза "заметили ошибку"
                    time.sleep(random.uniform(0.2, 0.5))
                    
                    # Удаляем ошибочные символы
                    for _ in range(1 + extra_chars):
                        element.input('\b')
                        time.sleep(random.uniform(0.05, 0.1))
            
            # Вводим правильный символ
            element.input(char)
            self._chars_typed += 1
            
            # Задержка между символами
            delay = random.uniform(*delay_range)
            
            # Дополнительная пауза после определённых символов
            if char in '.,!?@':
                delay += random.uniform(0.1, 0.3)
            elif char == ' ':
                delay += random.uniform(0.05, 0.15)
            
            time.sleep(delay)
            i += 1
    
    def _get_typo_char(self, char: str) -> str | None:
        """Возвращает реалистичную опечатку для символа"""
        char_lower = char.lower()
        
        # Используем соседние клавиши
        if char_lower in self.NEARBY_KEYS:
            nearby = self.NEARBY_KEYS[char_lower]
            typo = random.choice(nearby)
            # Сохраняем регистр
            return typo.upper() if char.isupper() else typo
        
        # Для других символов - случайная буква
        if char.isalpha():
            typo = random.choice(string.ascii_lowercase)
            return typo.upper() if char.isupper() else typo
        
        return None
    
    def think_before_typing(self, field_type: str = 'default'):
        """
        Пауза "на подумать" перед вводом.
        Разная длительность для разных типов полей.
        """
        if field_type == 'password':
            # Вспоминаем пароль
            time.sleep(random.uniform(0.8, 2.0))
        elif field_type == 'code':
            # Смотрим на код в письме/SMS
            time.sleep(random.uniform(1.0, 2.5))
        elif field_type == 'email':
            # Email обычно помним хорошо
            time.sleep(random.uniform(0.2, 0.5))
        else:
            time.sleep(random.uniform(0.3, 0.8))
    
    def human_click(self, element, pre_delay: bool = True):
        """Кликает с человеческой задержкой"""
        if pre_delay:
            self.human_delay(0.2, 0.5)
        element.click()
        self.human_delay(0.1, 0.3)
    
    def human_js_click(self, page, element, pre_delay: bool = True):
        """Кликает через JS с человеческой задержкой и скроллом"""
        if pre_delay:
            self.human_delay(0.15, 0.4)
        
        try:
            # Скроллим к элементу плавно
            page.run_js('''
                arguments[0].scrollIntoView({behavior: "smooth", block: "center"});
            ''', element)
            self.human_delay(0.1, 0.25)
            
            # Клик
            page.run_js('arguments[0].click()', element)
        except Exception:
            try:
                element.click()
            except Exception:
                pass
        
        self.human_delay(0.1, 0.3)
    
    def random_mouse_movement(self, browser, count: Optional[int] = None):
        """
        Случайные движения мыши по странице.
        
        Args:
            browser: BrowserAutomation instance (должен иметь .page)
            count: Количество движений
        """
        if count is None:
            count = random.randint(2, 5)
        
        try:
            for _ in range(count):
                x = random.randint(100, 800)
                y = random.randint(100, 600)
                
                browser.page.run_js(f'''
                    const event = new MouseEvent('mousemove', {{
                        clientX: {x},
                        clientY: {y},
                        bubbles: true
                    }});
                    document.dispatchEvent(event);
                ''')
                
                time.sleep(random.uniform(0.1, 0.3))
        except Exception:
            pass
    
    def scroll_page(self, browser, direction: str = 'down', amount: Optional[int] = None):
        """
        Прокручивает страницу.
        
        Args:
            browser: BrowserAutomation instance
            direction: 'up' или 'down'
            amount: Количество пикселей
        """
        if amount is None:
            amount = random.randint(100, 400)
        
        if direction == 'up':
            amount = -amount
        
        try:
            browser.page.run_js(f'window.scrollBy(0, {amount});')
            self.human_delay(0.2, 0.5)
        except Exception:
            pass



    
    # ========================================================================
    # ADVANCED HUMAN SIMULATION
    # ========================================================================
    
    def simulate_page_reading(self, page, duration: Optional[float] = None):
        """
        Симулирует чтение страницы: движения глаз (мыши), скролл, паузы.
        
        Args:
            page: DrissionPage instance
            duration: Длительность симуляции (None = случайная 2-5 сек)
        """
        if duration is None:
            duration = random.uniform(2.0, 5.0)
        
        start_time = time.time()
        
        while time.time() - start_time < duration:
            action = random.choice(['mouse_move', 'scroll', 'pause'])
            
            if action == 'mouse_move':
                # Движение мыши как при чтении (сверху вниз, слева направо)
                x = random.randint(200, 900)
                y = random.randint(150, 500)
                try:
                    page.run_js(f'''
                        document.dispatchEvent(new MouseEvent('mousemove', {{
                            clientX: {x}, clientY: {y}, bubbles: true
                        }}));
                    ''')
                except Exception:
                    pass
                time.sleep(random.uniform(0.1, 0.3))
            
            elif action == 'scroll':
                # Небольшой скролл
                scroll_amount = random.randint(50, 150)
                direction = random.choice([1, -1])
                try:
                    page.run_js(f'window.scrollBy(0, {scroll_amount * direction});')
                except Exception:
                    pass
                time.sleep(random.uniform(0.2, 0.5))
            
            else:  # pause
                time.sleep(random.uniform(0.3, 0.8))
    
    def simulate_form_hesitation(self, page):
        """
        Симулирует колебание перед заполнением формы.
        Человек обычно осматривает форму перед вводом.
        """
        # Движения мыши по форме
        form_positions = [
            (300, 200), (500, 200), (300, 300), (500, 300), (400, 400)
        ]
        
        for x, y in random.sample(form_positions, k=random.randint(2, 4)):
            x += random.randint(-30, 30)
            y += random.randint(-30, 30)
            try:
                page.run_js(f'''
                    document.dispatchEvent(new MouseEvent('mousemove', {{
                        clientX: {x}, clientY: {y}, bubbles: true
                    }}));
                ''')
            except Exception:
                pass
            time.sleep(random.uniform(0.1, 0.25))
        
        # Пауза "на подумать"
        time.sleep(random.uniform(0.3, 0.8))
    
    def simulate_distraction(self, page, probability: float = 0.15):
        """
        Симулирует отвлечение пользователя (с заданной вероятностью).
        Человек иногда отвлекается во время заполнения форм.
        
        Args:
            page: DrissionPage instance
            probability: Вероятность отвлечения (0.0 - 1.0)
        """
        if random.random() > probability:
            return
        
        distraction_type = random.choice(['long_pause', 'scroll_away', 'mouse_wander'])
        
        if distraction_type == 'long_pause':
            # Просто долгая пауза (отвлёкся на телефон/чат)
            time.sleep(random.uniform(2.0, 5.0))
        
        elif distraction_type == 'scroll_away':
            # Скролл в сторону и обратно
            try:
                page.run_js(f'window.scrollBy(0, {random.randint(100, 300)});')
                time.sleep(random.uniform(0.5, 1.5))
                page.run_js(f'window.scrollBy(0, {random.randint(-300, -100)});')
            except Exception:
                pass
            time.sleep(random.uniform(0.3, 0.6))
        
        elif distraction_type == 'mouse_wander':
            # Мышь уходит в угол экрана
            corners = [(50, 50), (1200, 50), (50, 700), (1200, 700)]
            corner = random.choice(corners)
            try:
                page.run_js(f'''
                    document.dispatchEvent(new MouseEvent('mousemove', {{
                        clientX: {corner[0]}, clientY: {corner[1]}, bubbles: true
                    }}));
                ''')
            except Exception:
                pass
            time.sleep(random.uniform(1.0, 3.0))
    

    
    def random_micro_movements(self, page, count: Optional[int] = None):
        """
        Микро-движения мыши (тремор руки, небольшие корректировки).
        Делает поведение более человечным.
        
        Args:
            page: DrissionPage instance
            count: Количество микро-движений
        """
        if count is None:
            count = random.randint(3, 8)
        
        try:
            # Получаем текущую позицию (примерно центр экрана)
            base_x = random.randint(400, 800)
            base_y = random.randint(300, 500)
            
            for _ in range(count):
                # Небольшое отклонение (1-5 пикселей)
                dx = random.randint(-5, 5)
                dy = random.randint(-5, 5)
                
                page.run_js(f'''
                    document.dispatchEvent(new MouseEvent('mousemove', {{
                        clientX: {base_x + dx},
                        clientY: {base_y + dy},
                        bubbles: true
                    }}));
                ''')
                
                time.sleep(random.uniform(0.02, 0.08))
                
                base_x += dx
                base_y += dy
        except Exception:
            pass

    # ========================================================================
    # FWCIM-COMPATIBLE INPUT (Critical for AWS detection bypass)
    # ========================================================================
    
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
        delay_range: Tuple[float, float] = cast(Tuple[float, float], field_config['delay'])
        
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
