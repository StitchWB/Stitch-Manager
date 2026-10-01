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
import string
import time
from typing import cast

from .behavior_fwcim import BehaviorFwcimMixin
from .behavior_simulation import BehaviorSimulationMixin


class BehaviorSpoofModule(BehaviorFwcimMixin, BehaviorSimulationMixin):
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

    def human_delay(self, min_delay: float | None = None, max_delay: float | None = None):
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

    def simulate_reading(self, duration: float | None = None):
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
        delay_range: tuple[float, float] = cast(tuple[float, float], field_config['delay'])
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
