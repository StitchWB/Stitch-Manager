# Autoreg Services

Shared services for account registration automation.

## Services

### AddyIoService

Email alias generation via [addy.io](https://addy.io) API.

```python
from autoreg.services import AddyIoService, AddyIoConfig

config = AddyIoConfig(api_token="addy_io_...")
service = AddyIoService(config)

# Create alias
alias = service.create_alias(description="GitHub registration")
print(alias['email'])  # happy-elephant-123@yourdomain.anonaddy.me

# Delete alias
service.delete_alias(alias['id'])
service.close()
```

### EmailManager

Unified email generation with multiple strategies.

```python
from autoreg.services import EmailManager, EmailContext
from autoreg.shared.models import EmailStrategy, AddyIoConfig

# Strategy 1: Static email
manager = EmailManager(EmailStrategy.STATIC, "test@example.com")
ctx = manager.generate_email()
print(ctx.email)  # test@example.com

# Strategy 2: Counter (plus-addressing)
manager = EmailManager(EmailStrategy.COUNTER, "test@example.com")
ctx = manager.generate_email()
print(ctx.email)  # test+0@example.com

# Strategy 3: Addy.io aliases
addyio_config = AddyIoConfig(api_token="addy_io_...")
manager = EmailManager(
    EmailStrategy.ADDYIO,
    "recipient@gmail.com",
    addyio_config=addyio_config
)
ctx = manager.generate_email(description="Registration")
print(ctx.email)  # random-alias@yourdomain.anonaddy.me

# Cleanup
manager.cleanup_email(ctx)
manager.close()
```

## Quick Start

```bash
# Set environment variables
export ADDYIO_API_TOKEN="addy_io_..."
export IMAP_USER="myemail@gmail.com"
export IMAP_PASSWORD="app_password"

# Test addy.io service
python python/test_addyio_integration.py service

# Test email manager
python python/test_addyio_integration.py

# Use in registration
python python/run_windsurf_with_addyio.py
```

## Documentation

See [ADDYIO_INTEGRATION.md](../../../docs/ADDYIO_INTEGRATION.md) for full documentation.
