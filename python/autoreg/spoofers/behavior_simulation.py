"""Симуляция взаимодействия со страницей: клики, движения мыши, скролл, чтение."""

import random
import time


class BehaviorSimulationMixin:
    """Симуляция действий пользователя на странице: клики, мышь, скролл, отвлечения."""

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

    def random_mouse_movement(self, browser, count: int | None = None):
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

    def scroll_page(self, browser, direction: str = 'down', amount: int | None = None):
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

    def simulate_page_reading(self, page, duration: float | None = None):
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

    def random_micro_movements(self, page, count: int | None = None):
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
