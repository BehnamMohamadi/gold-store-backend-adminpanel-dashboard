# gold-store — accountStatus

This version still stops at Auth/Security + Account/User management.

## accountStatus

`isActive` has been removed.

- active
- deactivated
- suspended

Fields:

- accountStatus.status
- accountStatus.reason
- accountStatus.at
- accountStatus.by

## Updated files

- models/user-model.js
- middleware/auth-middleware.js
- middleware/validate.js
- controller/auth-controller.js
- controller/account-controller.js
- controller/user-controller.js
- controller/error-handler-controller.js
- validation/account-validation.js
- validation/user-validation.js
- routes/api/auth-route.js
- scripts/seed-admin.js

Also includes:

- soft delete for user accounts
- soft deactivation for admin DELETE
- exact duplicate email/phonenumber errors
- forbidden PATCH fields now cause validation errors
- logged-in users cannot login/register again until logout
