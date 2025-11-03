# Survey Application - API Documentation

## Table of Contents
1. [Base URL](#base-url)
2. [Authentication](#authentication)
3. [Response Format](#response-format)
4. [Admin APIs](#admin-apis)
5. [User APIs](#user-apis)
6. [Survey APIs](#survey-apis)
7. [Draft APIs](#draft-apis)
8. [Sharing APIs](#sharing-apis)
9. [Response APIs](#response-apis)
10. [Error Codes](#error-codes)

---

## Base URL

```
Development: http://localhost:8091
Production: [Your Production URL]
```

---

## Authentication

Most API endpoints require authentication via session cookies. Admin endpoints require `role: 'admin'`, while user endpoints require `role: 'user'` or `'admin'`.

### Session Management
- Sessions stored server-side using `express-session`
- Session cookie: `connect.sid`
- Session contains: `{ id, username, role }`

---

## Response Format

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "message": "Optional success message"
}
```

### Error Response
```json
{
  "success": false,
  "error": "Error message describing what went wrong"
}
```

---

## Admin APIs

### 1. Admin Login

**Endpoint:** `POST /admin/login`

**Authentication:** Not required

**Request Body:**
```json
{
  "username": "admin",
  "password": "admin123"
}
```

**Success Response:**
- HTTP 302 Redirect to `/` (admin dashboard)

**Error Response:**
- HTTP 401: Invalid credentials
- Renders login page with error message

**Example:**
```bash
curl -X POST http://localhost:8091/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  -c cookies.txt
```

---

### 2. Create User

**Endpoint:** `POST /admin/users`

**Authentication:** Required (Admin only)

**Request Body (Form Data):**
```
username: string (required)
password: string (required)
```

**Success Response:**
- HTTP 302 Redirect to `/admin` with success message

**Error Response:**
- HTTP 400: Username already exists
- HTTP 401: Not authorized
- HTTP 500: Server error

**Example:**
```bash
curl -X POST http://localhost:8091/admin/users \
  -b cookies.txt \
  -d "username=newuser&password=password123"
```

---

## User APIs

### 3. User Login

**Endpoint:** `POST /user/login`

**Authentication:** Not required

**Request Body:**
```json
{
  "username": "user1",
  "password": "password",
  "redirect": "/user/dashboard" // Optional
}
```

**Success Response:**
- HTTP 302 Redirect to `redirect` URL or `/user/dashboard`

**Error Response:**
- HTTP 401: Invalid credentials

**Example:**
```bash
curl -X POST http://localhost:8091/user/login \
  -H "Content-Type: application/json" \
  -d '{"username":"user1","password":"password"}' \
  -c cookies.txt
```

---

### 4. Get Current User Info

**Endpoint:** `GET /api/me`

**Authentication:** Required

**Success Response:**
```json
{
  "success": true,
  "user": {
    "id": "6903999d7e0cad2086dd555d",
    "username": "user1",
    "role": "user"
  }
}
```

**Error Response:**
- HTTP 401: Not logged in

**Example:**
```bash
curl -X GET http://localhost:8091/api/me \
  -b cookies.txt
```

---

### 5. Get Assigned Forms

**Endpoint:** `GET /api/user/assigned-forms`

**Authentication:** Required

**Success Response:**
```json
{
  "success": true,
  "forms": [
    {
      "surveyId": "6903a04854e255d999d41e56",
      "title": "Customer Survey",
      "createdAt": "2024-01-15T10:30:00Z",
      "publicUrl": "http://localhost:8091/f/6903a04854e255d999d41e56/6903999d7e0cad2086dd555d",
      "isAssigned": true
    }
  ]
}
```

**Example:**
```bash
curl -X GET http://localhost:8091/api/user/assigned-forms \
  -b cookies.txt
```

---

### 6. Get Shared Forms

**Endpoint:** `GET /api/user/shared-forms`

**Authentication:** Required

**Success Response:**
```json
{
  "success": true,
  "forms": [
    {
      "surveyId": "6903a04854e255d999d41e56",
      "title": "Team Survey",
      "createdAt": "2024-01-15T10:30:00Z",
      "sharedAt": "2024-01-16T14:20:00Z",
      "ownerId": "69039785668288c167430e0e",
      "publicUrl": "http://localhost:8091/f/6903a04854e255d999d41e56/69039785668288c167430e0e",
      "isShared": true
    }
  ]
}
```

**Example:**
```bash
curl -X GET http://localhost:8091/api/user/shared-forms \
  -b cookies.txt
```

---

## Survey APIs

### 7. List All Surveys

**Endpoint:** `GET /api/surveys/list`

**Authentication:** Required (Admin only)

**Success Response:**
```json
{
  "success": true,
  "surveys": [
    {
      "id": "6903a04854e255d999d41e56",
      "title": "Customer Survey",
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

**Example:**
```bash
curl -X GET http://localhost:8091/api/surveys/list \
  -b cookies.txt
```

---

### 8. Save Survey

**Endpoint:** `POST /api/survey/save`

**Authentication:** Required (Admin only)

**Request Body:**
```json
{
  "title": "Customer Survey",
  "json": {
    "pages": [
      {
        "name": "page1",
        "elements": [
          {
            "type": "text",
            "name": "question1",
            "title": "What is your name?",
            "isRequired": true
          }
        ]
      }
    ]
  }
}
```

**Success Response:**
```json
{
  "success": true,
  "survey": {
    "_id": "6903a04854e255d999d41e56",
    "id": "6903a04854e255d999d41e56",
    "title": "Customer Survey",
    "json": { ... },
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

**Example:**
```bash
curl -X POST http://localhost:8091/api/survey/save \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"title":"My Survey","json":{"pages":[]}}'
```

---

### 9. Export Survey

**Endpoint:** `GET /api/survey/:id/export`

**Authentication:** Required

**URL Parameters:**
- `id` (string, required): Survey ID (MongoDB `_id`)

**Success Response:**
```json
{
  "success": true,
  "survey": {
    "id": "6903a04854e255d999d41e56",
    "title": "Customer Survey",
    "json": { ... }
  }
}
```

**Error Response:**
- HTTP 404: Survey not found
- HTTP 500: Server error

**Example:**
```bash
curl -X GET http://localhost:8091/api/survey/6903a04854e255d999d41e56/export \
  -b cookies.txt
```

---

### 10. Delete Survey

**Endpoint:** `DELETE /api/survey/:id`

**Authentication:** Required (Admin only)

**URL Parameters:**
- `id` (string, required): Survey ID

**Success Response:**
```json
{
  "success": true,
  "message": "Survey deleted"
}
```

**Note:** Also deletes associated responses and drafts

**Example:**
```bash
curl -X DELETE http://localhost:8091/api/survey/6903a04854e255d999d41e56 \
  -b cookies.txt
```

---

## Draft APIs

### 11. Save Draft

**Endpoint:** `POST /api/draft/save`

**Authentication:** Required

**Request Body:**
```json
{
  "surveyId": "6903a04854e255d999d41e56",
  "userId": "6903999d7e0cad2086dd555d",
  "data": {
    "question1": "John Doe",
    "question2": "Yes",
    "pageNo": 1
  }
}
```

**Success Response:**
```json
{
  "success": true,
  "upserted": true,
  "matchedCount": 0
}
```

**Error Response:**
- HTTP 400: Missing surveyId or data
- HTTP 403: No access to this survey
- HTTP 503: Database unavailable

**Example:**
```bash
curl -X POST http://localhost:8091/api/draft/save \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"surveyId":"6903a04854e255d999d41e56","userId":"6903999d7e0cad2086dd555d","data":{"question1":"answer"}}'
```

---

### 12. Load Draft

**Endpoint:** `GET /api/draft/:surveyId/:userId`

**Authentication:** Required

**URL Parameters:**
- `surveyId` (string, required): Survey ID
- `userId` (string, required): User ID (assigned owner or share owner)

**Success Response:**
```json
{
  "success": true,
  "data": {
    "question1": "John Doe",
    "question2": "Yes",
    "pageNo": 1
  },
  "updatedAt": "2024-01-15T11:30:00Z",
  "savedByUserId": "6903999d7e0cad2086dd555d"
}
```

**Error Response:**
- HTTP 403: No access to this survey
- HTTP 404: Draft not found
- HTTP 503: Database unavailable

**Example:**
```bash
curl -X GET http://localhost:8091/api/draft/6903a04854e255d999d41e56/6903999d7e0cad2086dd555d \
  -b cookies.txt
```

---

## Sharing APIs

### 13. Share Survey

**Endpoint:** `POST /api/survey/:surveyId/share`

**Authentication:** Required (Owner or Admin only)

**URL Parameters:**
- `surveyId` (string, required): Survey ID

**Request Body:**
```json
{
  "userIds": [
    "69039785668288c167430e0e",
    "6903999d7e0cad2086dd555d"
  ]
}
```

**Success Response:**
```json
{
  "success": true,
  "message": "Survey shared successfully",
  "sharedCount": 2
}
```

**Error Response:**
- HTTP 400: Invalid userIds
- HTTP 403: Only owner can share
- HTTP 404: Survey not found

**Example:**
```bash
curl -X POST http://localhost:8091/api/survey/6903a04854e255d999d41e56/share \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"userIds":["69039785668288c167430e0e"]}'
```

---

### 14. Get Shared Users

**Endpoint:** `GET /api/survey/:surveyId/shared`

**Authentication:** Required

**URL Parameters:**
- `surveyId` (string, required): Survey ID

**Success Response:**
```json
{
  "success": true,
  "sharedWith": [
    {
      "id": "69039785668288c167430e0e",
      "username": "user2",
      "role": "user"
    }
  ]
}
```

**Example:**
```bash
curl -X GET http://localhost:8091/api/survey/6903a04854e255d999d41e56/shared \
  -b cookies.txt
```

---

### 15. Remove Sharing Access

**Endpoint:** `DELETE /api/survey/:surveyId/share/:userId`

**Authentication:** Required (Owner or Admin only)

**URL Parameters:**
- `surveyId` (string, required): Survey ID
- `userId` (string, required): User ID to remove access from

**Success Response:**
```json
{
  "success": true,
  "message": "Access removed successfully"
}
```

**Error Response:**
- HTTP 403: Only owner can remove sharing
- HTTP 404: Sharing record not found

**Example:**
```bash
curl -X DELETE http://localhost:8091/api/survey/6903a04854e255d999d41e56/share/69039785668288c167430e0e \
  -b cookies.txt
```

---

### 16. Get Surveys Shared With Me

**Endpoint:** `GET /api/surveys/shared-with-me`

**Authentication:** Required

**Success Response:**
```json
{
  "success": true,
  "surveys": [
    {
      "surveyId": "6903a04854e255d999d41e56",
      "title": "Team Survey",
      "owner": {
        "id": "69039785668288c167430e0e",
        "username": "owner_user"
      },
      "ownerLink": "http://localhost:8091/f/6903a04854e255d999d41e56/69039785668288c167430e0e",
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

**Example:**
```bash
curl -X GET http://localhost:8091/api/surveys/shared-with-me \
  -b cookies.txt
```

---

### 17. List Users for Sharing

**Endpoint:** `GET /api/users/list`

**Authentication:** Required

**Success Response:**
```json
{
  "success": true,
  "users": [
    {
      "id": "69039785668288c167430e0e",
      "username": "user2",
      "role": "user"
    }
  ]
}
```

**Note:** Excludes current logged-in user

**Example:**
```bash
curl -X GET http://localhost:8091/api/users/list \
  -b cookies.txt
```

---

## Response APIs

### 18. Submit Survey Response

**Endpoint:** `POST /api/survey/:id/respond`

**Authentication:** Required

**URL Parameters:**
- `id` (string, required): Survey ID

**Request Body:**
```json
{
  "_userId": "6903999d7e0cad2086dd555d",
  "question1": "John Doe",
  "question2": "Yes",
  "question3": "Satisfied"
}
```

**Success Response:**
```json
{
  "success": true,
  "message": "Response submitted successfully",
  "responseId": "6904a04854e255d999d41e99"
}
```

**Error Response:**
- HTTP 400: Invalid request body
- HTTP 500: Server error

**Example:**
```bash
curl -X POST http://localhost:8091/api/survey/6903a04854e255d999d41e56/respond \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"_userId":"6903999d7e0cad2086dd555d","question1":"answer1"}'
```

---

## Bulk Operations APIs

### 19. Bulk Generate Links

**Endpoint:** `POST /api/bulk-generate-links`

**Authentication:** Required (Admin only)

**Request Type:** `multipart/form-data`

**Request Body:**
- `csvfile` (file, required): CSV file with format:
  ```
  surveyId1,userId1
  surveyId2,userId2
  surveyId3,userId3
  ```

**Success Response:**
```json
{
  "success": true,
  "totalRows": 3,
  "successCount": 3,
  "errorCount": 0,
  "results": [
    {
      "row": 1,
      "surveyId": "6903a04854e255d999d41e56",
      "userId": "6903999d7e0cad2086dd555d",
      "link": "http://localhost:8091/f/6903a04854e255d999d41e56/6903999d7e0cad2086dd555d",
      "status": "success"
    }
  ],
  "errors": []
}
```

**Error Response:**
- HTTP 400: CSV file is required
- HTTP 500: Processing error

**Example:**
```bash
curl -X POST http://localhost:8091/api/bulk-generate-links \
  -b cookies.txt \
  -F "csvfile=@links.csv"
```

---

## Page Routes (Non-API)

### 20. Admin Dashboard

**Endpoint:** `GET /admin`

**Authentication:** Required (Admin only)

**Response:** Renders admin dashboard HTML page

---

### 21. User Dashboard

**Endpoint:** `GET /user/dashboard`

**Authentication:** Required

**Response:** Renders user dashboard HTML page

---

### 22. Form Builder

**Endpoint:** `GET /`

**Authentication:** Required (Admin only)

**Response:** Renders SurveyJS form builder

---

### 23. Public Form Link

**Endpoint:** `GET /f/:surveyId/:userId`

**Authentication:** Required (redirects to login if not authenticated)

**URL Parameters:**
- `surveyId` (string, required): Survey ID
- `userId` (string, required): Assigned user ID (owner)

**Authorization:**
- Must be owner (`loggedInUserId === userId`) OR
- Must be shared with user (check sharing collection)

**Response:** 
- Renders dynamic form page if authorized
- HTTP 403 if access denied
- Redirects to login if not authenticated

**Example:**
```
http://localhost:8091/f/6903a04854e255d999d41e56/6903999d7e0cad2086dd555d
```

---

## Error Codes

| Status Code | Description | Common Causes |
|-------------|-------------|---------------|
| 200 | Success | Request processed successfully |
| 302 | Redirect | Authentication redirect, success redirect |
| 400 | Bad Request | Missing required fields, invalid data |
| 401 | Unauthorized | Not logged in, invalid credentials |
| 403 | Forbidden | Access denied, insufficient permissions |
| 404 | Not Found | Resource doesn't exist |
| 500 | Internal Server Error | Server error, database error |
| 503 | Service Unavailable | Database connection issues |

---

## Rate Limiting

Currently, there is no rate limiting implemented. Consider adding rate limiting for production environments.

---

## CORS Policy

CORS is not explicitly configured. For production, configure CORS based on your frontend domain.

---

## Data Models

### Survey Model
```javascript
{
  _id: ObjectId,
  id: String, // Same as _id as string
  title: String,
  json: Object, // SurveyJS JSON structure
  createdAt: Date
}
```

### User Model
```javascript
{
  _id: ObjectId,
  username: String (unique),
  password: String (plain text - consider hashing),
  role: String ('user' | 'admin'),
  createdAt: Date
}
```

### Draft Model
```javascript
{
  _id: ObjectId,
  surveyId: String,
  ownerId: String, // User ID from URL parameter
  savedByUserId: String, // Who saved this draft
  data: Object, // Form data
  updatedAt: Date
}
// Index: { surveyId: 1, ownerId: 1 } (unique)
```

### Response Model
```javascript
{
  _id: ObjectId,
  surveyId: String,
  userId: String,
  data: Object, // Response data
  submittedAt: Date
}
```

### Sharing Model
```javascript
{
  _id: ObjectId,
  surveyId: String,
  ownerId: String, // Owner who shared
  sharedWithUserId: String, // User shared with
  createdAt: Date
}
// Index: { surveyId: 1, sharedWithUserId: 1 } (unique)
```

---

## Testing Examples

### Complete Workflow Test

```bash
# 1. Admin Login
curl -X POST http://localhost:8091/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  -c cookies.txt -v

# 2. Create User
curl -X POST http://localhost:8091/admin/users \
  -b cookies.txt \
  -d "username=testuser&password=testpass"

# 3. Save Survey
curl -X POST http://localhost:8091/api/survey/save \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Survey","json":{"pages":[]}}'

# 4. Get Surveys
curl -X GET http://localhost:8091/api/surveys/list \
  -b cookies.txt

# 5. User Login
curl -X POST http://localhost:8091/user/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"testpass"}' \
  -c user_cookies.txt

# 6. Save Draft
curl -X POST http://localhost:8091/api/draft/save \
  -b user_cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"surveyId":"SURVEY_ID","userId":"USER_ID","data":{"test":"value"}}'

# 7. Submit Response
curl -X POST http://localhost:8091/api/survey/SURVEY_ID/respond \
  -b user_cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"_userId":"USER_ID","answer":"response"}'
```

---

## Notes

1. **Session Management**: All authenticated requests require valid session cookie
2. **ID Format**: Use MongoDB ObjectId strings for all ID parameters
3. **Draft Ownership**: Drafts are stored by `{surveyId, ownerId}` combination
4. **Sharing**: Sharing creates access records but doesn't duplicate drafts
5. **Bulk Operations**: CSV files should be UTF-8 encoded
6. **Error Handling**: Always check `success` field in JSON responses
7. **URL Encoding**: URL parameters should be properly encoded

---

## Version History

- **v1.0**: Initial API implementation
  - Basic CRUD operations
  - Authentication and authorization
  - Draft management
  - Survey sharing
  - Bulk link generation

---

## Support

For issues or questions:
- Check error messages in API responses
- Verify authentication status
- Ensure proper request format
- Review workflow documentation

