"""
Example usage of Mail.tm email provider

Mail.tm provides free temporary email addresses that are perfect for
automated registration testing.
"""

from autoreg.email_providers.generators import MailTmEmailGenerator
from autoreg.email_providers.strategies import MailTmStrategy
from autoreg.services.mailtm import MailTmConfig


def example_basic_usage():
    """Basic Mail.tm email generation"""
    print("=== Basic Mail.tm Usage ===\n")

    # Create generator
    generator = MailTmEmailGenerator()

    # Generate temporary email
    context = generator.generate("GitHub registration")
    print(f"Generated email: {context.email}")
    print(f"Account ID: {context.alias_id}")
    print(f"Password: {context.metadata['password']}")

    # Cleanup when done
    generator.cleanup(context)
    print("Email deleted\n")


def example_with_verification():
    """Mail.tm with email verification"""
    print("=== Mail.tm with Verification ===\n")

    # Create strategy (combines generation + verification)
    strategy = MailTmStrategy()

    # Generate email and wait for verification code
    context, code = strategy.generate_and_verify(
        description="GitHub registration",
        sender_keywords=['github', 'noreply@github.com'],
        max_wait=120
    )

    print(f"Generated email: {context.email}")
    if code:
        print(f"Verification code: {code}")
    else:
        print("No verification code received")

    # Cleanup
    strategy.generator.cleanup(context)
    strategy.close()
    print("Email deleted\n")


def example_context_manager():
    """Using context manager for automatic cleanup"""
    print("=== Mail.tm with Context Manager ===\n")

    generator = MailTmEmailGenerator()

    # Automatic cleanup on exit
    with generator.generate_with_cleanup("Test registration") as context:
        print(f"Using email: {context.email}")
        # Do registration here
        # Email will be automatically deleted when exiting context

    print("Email automatically deleted\n")


def example_custom_config():
    """Using custom Mail.tm configuration"""
    print("=== Mail.tm with Custom Config ===\n")

    # Custom configuration
    config = MailTmConfig(
        base_url="https://api.mail.tm",
        timeout=60
    )

    generator = MailTmEmailGenerator(config)
    context = generator.generate("Custom config test")

    print(f"Generated email: {context.email}")

    generator.cleanup(context)
    print("Email deleted\n")


if __name__ == "__main__":
    # Run examples
    example_basic_usage()
    example_with_verification()
    example_context_manager()
    example_custom_config()
