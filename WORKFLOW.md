# Survey Application - Workflow Documentation

## Table of Contents
1. [System Overview](#system-overview)
2. [User Roles](#user-roles)
3. [Workflow Diagrams](#workflow-diagrams)
4. [Feature Workflows](#feature-workflows)
5. [Data Flow](#data-flow)

---

## System Overview

This is a comprehensive survey and form management platform built with Express.js, MongoDB, and SurveyJS. The system enables organizations to create, distribute, and manage surveys with role-based access control, draft saving, and collaborative features.

### Key Technologies
- **Backend**: Express.js (Node.js)
- **Database**: MongoDB Atlas
- **Frontend**: SurveyJS, Tailwind CSS, Nunjucks
- **Authentication**: express-session

---

## User Roles

### 1. Administrator
- **Access Level**: Full system access
- **Capabilities**:
  - Create and manage user accounts
  - Build surveys using SurveyJS form builder
  - Generate public form links for specific users
  - Bulk generate links via CSV upload
  - View and manage all surveys
  - Delete surveys and responses

### 2. Regular User
- **Access Level**: Limited to assigned/shared forms
- **Capabilities**:
  - View assigned forms via dashboard
  - Access and fill out assigned forms
  - Save drafts and resume later
  - Submit completed forms
  - View shared forms (if shared by owner)
  - Collaborate on shared forms

---

## Workflow Diagrams

### Administrator Workflow

```
1. Admin Login
   ├─> Login Page (/admin/login)
   ├─> Credentials: admin/admin123
   └─> Success → Admin Dashboard

2. Admin Dashboard (/admin)
   ├─> Create User
   │   ├─> Enter username/password
   │   └─> User created in MongoDB
   │
   ├─> Open Builder (/)
   │   ├─> SurveyJS Form Builder
   │   ├─> Design form with drag-and-drop
   │   ├─> Save Survey → MongoDB
   │   └─> Export JSON
   │
   ├─> Generate Public Link
   │   ├─> Enter Survey ID
   │   ├─> Enter User ID
   │   ├─> Generate Link: /f/{surveyId}/{userId}
   │   └─> Copy Link
   │
   └─> Bulk Generate Links
       ├─> Upload CSV (surveyId,userId)
       ├─> Process file
       ├─> Generate multiple links
       └─> Download results CSV
```

### User Workflow

```
1. User Login
   ├─> Login Page (/user/login)
   ├─> Enter credentials
   └─> Success → User Dashboard

2. User Dashboard (/user/dashboard)
   ├─> View Assigned Forms
   │   ├─> Lists all forms with user's ID
   │   ├─> Display public URLs
   │   └─> Copy/Open links
   │
   └─> View Shared Forms
       ├─> Lists forms shared by other users
       ├─> Display public URLs (owner's link)
       └─> Copy/Open links

3. Form Access
   ├─> Click "Open" on dashboard
   ├─> Navigate to /f/{surveyId}/{userId}
   ├─> Authentication check
   ├─> Authorization check
   └─> Load form (SurveyJS renders)

4. Form Filling
   ├─> Fill form fields
   ├─> Save Draft (optional)
   │   ├─> Draft saved to MongoDB
   │   └─> Auto-restore on next visit
   │
   └─> Submit Form
       ├─> Validate data
       ├─> Save to responses collection
       └─> Show success message
```

### Sharing Workflow

```
1. Owner Opens Form
   ├─> Access /f/{surveyId}/{userId}
   └─> Click "Share" button

2. Share Modal
   ├─> Load list of users (exclude self)
   ├─> Select users to share with
   └─> Click "Share Selected"

3. Sharing Created
   ├─> Record saved to sharing collection
   ├─> Shared users gain access
   └─> Shared users see form in dashboard

4. Shared User Access
   ├─> Shared user logs in
   ├─> Sees form in "Shared Forms" section
   ├─> Opens form using owner's URL
   ├─> Can fill and save draft (shared with owner)
   └─> Can submit responses
```

---

## Feature Workflows

### 1. Survey Creation Workflow

**Step-by-Step Process:**

1. **Admin Login**
   - Navigate to `/admin/login`
   - Enter credentials (admin/admin123)
   - Redirected to admin dashboard

2. **Access Builder**
   - Click "Open Builder" in admin dashboard
   - SurveyJS builder loads at `/`

3. **Design Form**
   - Use drag-and-drop interface
   - Add questions, text fields, dropdowns, etc.
   - Configure validation rules
   - Preview form

4. **Save Survey**
   - Click "Save Survey" button
   - Survey JSON sent to `/api/survey/save`
   - Saved to MongoDB `surveys` collection
   - Assigned unique `_id`

5. **Survey Management**
   - View all surveys in `/admin` or `/surveys`
   - Can export, delete, or generate links

### 2. Public Link Generation Workflow

**Single Link Generation:**

1. Admin navigates to `/admin`
2. Enters Survey ID (MongoDB `_id`)
3. Enters User ID (MongoDB `_id`)
4. Clicks "Generate Link"
5. Link format: `http://localhost:8091/f/{surveyId}/{userId}`
6. Copy button available for easy sharing

**Bulk Link Generation:**

1. Prepare CSV file:
   ```
   surveyId1,userId1
   surveyId2,userId2
   surveyId3,userId3
   ```

2. Admin uploads CSV in `/admin`
3. System processes each row
4. Generates public URLs
5. Displays results in table
6. Download results as CSV

### 3. Form Access Workflow

**Authentication & Authorization:**

1. User clicks form link or opens from dashboard
2. If not logged in:
   - Redirected to `/user/login?redirect={originalUrl}`
   - After login, redirected back to form

3. Authorization Check:
   - If `loggedInUserId === expectedUserId`: Access granted (owner)
   - Else check sharing collection: If shared, access granted
   - Otherwise: Access denied (403)

4. Form Loads:
   - Fetch survey JSON from MongoDB
   - Render with SurveyJS
   - Load draft if exists
   - Enable save/submit buttons

### 4. Draft Management Workflow

**Saving Draft:**

1. User fills form fields
2. Clicks "Save Draft" button
3. System captures:
   - Current form data
   - Current page number
   - Survey ID
   - User ID (from URL parameter)
4. Draft saved with key: `{surveyId, ownerId}`
5. Success message displayed

**Loading Draft:**

1. User opens form
2. System automatically checks for draft
3. If draft exists:
   - Load form data
   - Restore to saved page
   - Populate all fields
   - Show "Draft auto-restored" message
4. If no draft: Form loads fresh

**Draft Isolation:**

- Each assigned user has separate draft
- Shared users collaborate on owner's draft
- Drafts stored by `{surveyId, ownerId}` combination

### 5. Survey Sharing Workflow

**Owner Shares Form:**

1. Owner opens their assigned form (`/f/{surveyId}/{userId}`)
2. Sees "Share" button (only visible to owner)
3. Clicks "Share" button
4. Modal opens showing:
   - List of all users (excluding self)
   - Currently shared users list
5. Selects users to share with
6. Clicks "Share Selected"
7. Sharing records created in MongoDB
8. Shared users gain immediate access

**Shared User Access:**

1. Shared user logs in
2. Sees form in "Shared Forms" section of dashboard
3. Opens form using owner's URL: `/f/{surveyId}/{ownerUserId}`
4. Authorization check passes (share record exists)
5. Can fill form, save draft (shared with owner), submit

**Revoke Sharing:**

1. Owner opens Share modal
2. Sees list of shared users
3. Clicks "×" next to user name
4. Confirms removal
5. Sharing record deleted
6. User loses access immediately

### 6. Response Submission Workflow

1. User completes form
2. Clicks "Complete" button
3. SurveyJS validates form
4. `onComplete` event fires
5. Data sent to `/api/survey/{surveyId}/respond`
6. Response saved to MongoDB `responses` collection
7. Includes:
   - Survey ID
   - User ID
   - Response data
   - Timestamp
8. Success message displayed
9. Draft cleared (optional)

---

## Data Flow

### Survey Creation Flow

```
Admin → Builder UI → SurveyJS → JSON
  ↓
POST /api/survey/save
  ↓
MongoDB surveys collection
  ↓
{ _id, title, json, createdAt }
```

### Form Access Flow

```
User → /f/{surveyId}/{userId}
  ↓
Authentication Check → Login if needed
  ↓
Authorization Check → Verify access
  ↓
GET /api/survey/{surveyId}/export
  ↓
Survey JSON → SurveyJS.render()
  ↓
GET /api/draft/{surveyId}/{userId} (auto-restore)
  ↓
Form loads with data
```

### Draft Save Flow

```
User fills form → Click "Save Draft"
  ↓
POST /api/draft/save
Body: { surveyId, userId, data }
  ↓
Validate access → Determine ownerId
  ↓
MongoDB drafts collection
Key: { surveyId, ownerId }
Value: { data, savedByUserId, updatedAt }
```

### Sharing Flow

```
Owner → Share Modal → Select Users
  ↓
POST /api/survey/{surveyId}/share
Body: { userIds: [...] }
  ↓
MongoDB sharing collection
  ↓
{ surveyId, ownerId, sharedWithUserId, createdAt }
```

### Response Submission Flow

```
User completes form → Click "Complete"
  ↓
SurveyJS onComplete event
  ↓
POST /api/survey/{surveyId}/respond
Body: { ...formData, _userId }
  ↓
MongoDB responses collection
  ↓
{ surveyId, userId, data, submittedAt }
```

---

## Access Control Matrix

| Action | Admin | Owner | Shared User | Unauthorized User |
|--------|-------|-------|-------------|-------------------|
| Create surveys | ✅ | ❌ | ❌ | ❌ |
| View all surveys | ✅ | ❌ | ❌ | ❌ |
| Generate links | ✅ | ❌ | ❌ | ❌ |
| Access assigned form | ✅ | ✅ | ❌ | ❌ |
| Access shared form | ✅ | ✅ | ✅ | ❌ |
| Save draft | ✅ | ✅ | ✅ | ❌ |
| Submit response | ✅ | ✅ | ✅ | ❌ |
| Share form | ✅ | ✅ | ❌ | ❌ |
| Revoke sharing | ✅ | ✅ | ❌ | ❌ |

---

## Error Handling

### Common Scenarios

1. **Unauthorized Access**
   - User tries to access form without login
   - Redirect to login with redirect parameter

2. **Access Denied**
   - User tries to access form not assigned/shared
   - Shows 403 error page

3. **Draft Not Found**
   - User opens form with no saved draft
   - Form loads fresh (no error)

4. **Survey Not Found**
   - Invalid surveyId in URL
   - Returns 404 error

5. **Database Connection Issues**
   - All operations fail gracefully
   - Returns 503 Service Unavailable

---

## Best Practices

### For Administrators

1. Always use MongoDB `_id` for Survey ID and User ID when generating links
2. Use bulk CSV generation for multiple assignments
3. Regularly review and clean up unused surveys
4. Verify user credentials before sharing

### For Users

1. Save drafts frequently while filling long forms
2. Use dashboard to access all forms easily
3. Check shared forms section for collaborative forms
4. Contact admin if you don't see expected forms

---

## Security Considerations

1. **Authentication**: All form access requires login
2. **Authorization**: Users can only access assigned/shared forms
3. **Session Management**: Secure session storage
4. **Data Isolation**: Drafts and responses are user-specific
5. **Input Validation**: All API endpoints validate input
6. **Access Logging**: Consider adding audit logs for production

---

## Future Enhancements

Potential improvements:
- Email notifications for form assignments
- Response analytics and reporting
- Form versioning
- Template library
- Advanced sharing permissions (view-only, edit, etc.)
- Export responses to CSV/Excel
- Real-time collaboration indicators

---

## Conclusion

This platform provides a comprehensive solution for survey management with role-based access, draft saving, and collaborative features. The workflow ensures secure access, data isolation, and seamless user experience across all operations.

