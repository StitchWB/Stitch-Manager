import type { AuthTranslations } from '../../i18n/types/auth';

export const auth: AuthTranslations = {
  auth: {
    title: "Stitch Manager",
    subtitle: "Sign in to continue",
    username: "Username",
    usernamePlaceholder: "Enter username",
    password: "Password",
    passwordPlaceholder: "Enter password",
    submit: "Sign in",
    submitting: "Signing in...",
    error: "Invalid username or password",
    errorNetwork: "Could not reach server. Please try again.",
    logout: "Sign out",
    sessionExpired: "Your session has expired. Please sign in again.",
    back: "Back",
    role: {
      admin: "Admin",
      user: "User",
      vip: "VIP",
      premium: "Premium",
      elite: "Elite"
    },
    preview: {
      title: "Role preview",
      banner: "Your current role: {role}",
      myRole: "Admin (my role)",
      exit: "Exit role preview",
      error: "Failed to switch role"
    },
    guest: {
      title: "Welcome",
      subtitle: "Choose how to continue",
      continue: "Continue without login",
      createLocal: "Create local account",
      login: "Login",
      loginPassword: "Password login",
      noAccountHint: "No account? Create a local one",
      badge: "Guest",
      hint: "A local account protects access to this app on this device. You can change this later in Settings."
    },
    tg: {
      title: "Telegram Login",
      description: "Open our Telegram bot and send /login — the bot will DM you a one-time code.",
      codePlaceholder: "Enter code",
      submit: "Sign in",
      back: "Back",
      errorGeneric: "Telegram login failed. Please try again.",
      openBot: "Open the bot in Telegram",
      oidc: {
        button: "Log in with Telegram",
        orCode: "or",
        errorGeneric: "Telegram login failed. Please try again."
      },
      deepLink: {
        cta: "Log in with Telegram",
        waiting: "Waiting for Telegram confirmation…",
        cancel: "Cancel",
        expired: "The link has expired. Press the button again.",
        orCode: "or enter the code manually"
      },
      guide: {
        title: "How it works",
        step1: {
          title: "Press the button",
          text: "The Stitch bot chat opens with a prepared link"
        },
        step2: {
          title: "Tap START",
          text: "The bot issues a code and sends the confirmation to the app"
        },
        step3: {
          title: "Done",
          text: "Return to the app window — sign-in completes automatically"
        },
        botLink: "Stitch bot",
        channelLink: "Our Telegram channel",
        fallback: "You can still enter the code manually below — that option keeps working.",
        toggle: "How it works?"
      }
    },
    login: {
      tgLink: "Login via Telegram"
    },
    setup: {
      title: "Create Admin Account",
      subtitle: "Set up the first administrator to enable authentication",
      username: "Username",
      usernamePlaceholder: "Choose an admin username",
      password: "Password",
      passwordPlaceholder: "Choose a password",
      confirmPassword: "Confirm password",
      confirmPasswordPlaceholder: "Re-enter password",
      submit: "Create admin",
      submitting: "Creating admin...",
      errorMismatch: "Passwords do not match",
      errorExists: "An admin account already exists",
      errorValidation: "Username and password are required",
      adminBadge: "First admin"
    },
    users: {
      title: "Users",
      subtitle: "Manage who can sign in to this instance",
      addUser: "Add user",
      username: "Username",
      usernamePlaceholder: "Enter username",
      password: "Password",
      passwordPlaceholder: "Enter password",
      role: "Role",
      roleAdmin: "Admin",
      roleUser: "User",
      roleVip: "VIP",
      rolePremium: "Premium",
      roleElite: "Elite",
      create: "Create",
      creating: "Creating...",
      delete: "Delete",
      deleteTitle: "Delete user",
      deleteMessage: "Delete user \"{username}\"? This cannot be undone.",
      deleteConfirm: "Delete",
      empty: "No users yet",
      colUsername: "Username",
      colRole: "Role",
      colActions: "Actions",
      errorSelfDelete: "You cannot delete your own account",
      errorLastAdmin: "You cannot delete the last admin",
      errorDuplicate: "A user with that username already exists",
      errorValidation: "Username and password are required",
      created: "User created",
      deleted: "User deleted",
      updated: "Role updated",
      createFailed: "Failed to create user",
      deleteFailed: "Failed to delete user",
      loadFailed: "Failed to load users"
    }
  }
};
