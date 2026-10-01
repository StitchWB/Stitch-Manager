import type { AuthTranslations } from '../../i18n/types/auth';

export const auth: AuthTranslations = {
  auth: {
    title: "Stitch Manager",
    subtitle: "Войдите, чтобы продолжить",
    username: "Имя пользователя",
    usernamePlaceholder: "Введите имя пользователя",
    password: "Пароль",
    passwordPlaceholder: "Введите пароль",
    submit: "Войти",
    submitting: "Вход...",
    error: "Неверное имя пользователя или пароль",
    errorNetwork: "Не удалось связаться с сервером. Попробуйте снова.",
    logout: "Выйти",
    sessionExpired: "Сессия истекла. Пожалуйста, войдите снова.",
    back: "Назад",
    role: {
      admin: "Админ",
      user: "Пользователь",
      vip: "VIP",
      premium: "Премиум",
      elite: "Элита"
    },
    preview: {
      title: "Предпросмотр роли",
      banner: "Сейчас у вас роль: {role}",
      myRole: "Админ (моя роль)",
      exit: "Выйти из предпросмотра",
      error: "Не удалось переключить роль"
    },
    guest: {
      title: "Добро пожаловать",
      subtitle: "Выберите, как продолжить",
      continue: "Продолжить без входа",
      createLocal: "Создать локальную учётку",
      login: "Войти",
      loginPassword: "Войти по паролю",
      noAccountHint: "Нет учётки? Создайте локальную",
      badge: "Гость",
      hint: "Локальная учётка защищает доступ к приложению на этом устройстве. Это можно изменить позже в настройках."
    },
    tg: {
      title: "Вход через Telegram",
      description: "Откройте нашего бота в Telegram и отправьте /login — бот пришлёт одноразовый код.",
      codePlaceholder: "Введите код",
      submit: "Войти",
      back: "Назад",
      errorGeneric: "Не удалось войти через Telegram. Попробуйте снова.",
      openBot: "Открыть бота в Telegram",
      oidc: {
        button: "Войти через Telegram",
        orCode: "или",
        errorGeneric: "Не удалось войти через Telegram. Попробуйте снова."
      },
      deepLink: {
        cta: "Войти через Telegram",
        waiting: "Ожидание подтверждения в Telegram…",
        cancel: "Отмена",
        expired: "Ссылка истекла. Нажмите кнопку ещё раз.",
        orCode: "или введите код вручную"
      },
      guide: {
        title: "Как это работает",
        step1: {
          title: "Нажмите кнопку",
          text: "Откроется чат бота Stitch с подготовленной ссылкой"
        },
        step2: {
          title: "Нажмите START",
          text: "Бот выдаст код и передаст подтверждение в приложение"
        },
        step3: {
          title: "Готово",
          text: "Вернитесь в окно приложения — вход завершится сам"
        },
        botLink: "Бот Stitch",
        channelLink: "Наш канал в Telegram",
        fallback: "Код по-прежнему можно ввести вручную ниже — этот способ тоже работает.",
        toggle: "Как это работает?"
      }
    },
    login: {
      tgLink: "Войти через Telegram"
    },
    setup: {
      title: "Создать аккаунт администратора",
      subtitle: "Создайте первого администратора, чтобы включить аутентификацию",
      username: "Имя пользователя",
      usernamePlaceholder: "Выберите имя администратора",
      password: "Пароль",
      passwordPlaceholder: "Выберите пароль",
      confirmPassword: "Подтвердите пароль",
      confirmPasswordPlaceholder: "Повторите пароль",
      submit: "Создать администратора",
      submitting: "Создание администратора...",
      errorMismatch: "Пароли не совпадают",
      errorExists: "Аккаунт администратора уже существует",
      errorValidation: "Имя пользователя и пароль обязательны",
      adminBadge: "Первый администратор"
    },
    users: {
      title: "Пользователи",
      subtitle: "Управление доступом к этому экземпляру",
      addUser: "Добавить пользователя",
      username: "Имя пользователя",
      usernamePlaceholder: "Введите имя пользователя",
      password: "Пароль",
      passwordPlaceholder: "Введите пароль",
      role: "Роль",
      roleAdmin: "Админ",
      roleUser: "Пользователь",
      roleVip: "VIP",
      rolePremium: "Премиум",
      roleElite: "Элита",
      create: "Создать",
      creating: "Создание...",
      delete: "Удалить",
      deleteTitle: "Удалить пользователя",
      deleteMessage: "Удалить пользователя \"{username}\"? Это действие нельзя отменить.",
      deleteConfirm: "Удалить",
      empty: "Пользователей пока нет",
      colUsername: "Имя пользователя",
      colRole: "Роль",
      colActions: "Действия",
      errorSelfDelete: "Нельзя удалить свой собственный аккаунт",
      errorLastAdmin: "Нельзя удалить последнего администратора",
      errorDuplicate: "Пользователь с таким именем уже существует",
      errorValidation: "Имя пользователя и пароль обязательны",
      created: "Пользователь создан",
      deleted: "Пользователь удалён",
      updated: "Роль обновлена",
      createFailed: "Не удалось создать пользователя",
      deleteFailed: "Не удалось удалить пользователя",
      loadFailed: "Не удалось загрузить пользователей"
    }
  }
};
