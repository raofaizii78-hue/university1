const CONFIG = window.FIU_CONFIG || {};
const MIN_PASSWORD_LENGTH = 8;
const SESSION_TOKEN_KEY = 'fiu_access_token';
const SESSION_USER_KEY = 'fiu_user';
const configuredStudentEndpoints = CONFIG.endpoints?.students;
const STUDENT_ENDPOINTS = {
    list: '/students',
    getById: '/students/:id',
    create: '/students',
    update: '/students/:id',
    delete: '/students/:id',
    ...(typeof configuredStudentEndpoints === 'string'
        ? {
            list: configuredStudentEndpoints,
            getById: `${configuredStudentEndpoints.replace(/\/+$/, '')}/:id`,
            create: configuredStudentEndpoints,
            update: `${configuredStudentEndpoints.replace(/\/+$/, '')}/:id`,
            delete: `${configuredStudentEndpoints.replace(/\/+$/, '')}/:id`
        }
        : configuredStudentEndpoints || {})
};
const API_ENDPOINTS = {
    signIn: '/auth/signin',
    signUp: '/auth/signup',
    signOut: '/auth/signout',
    forgotPassword: '/auth/forgot-password',
    resetPassword: '/auth/reset-password',
    ...(CONFIG.endpoints || {}),
    students: STUDENT_ENDPOINTS
};

let currentUser = null;
let students = [];
let preferredViewAfterSignIn = 'home';
let passwordResetToken = null;

const authView = document.getElementById('auth-view');
const appShell = document.getElementById('authenticated-app');
const mainNav = document.getElementById('main-nav');
const accountEmail = document.getElementById('account-email');
const authStatus = document.getElementById('auth-status');
const authHeading = document.getElementById('auth-heading');
const authIntro = document.getElementById('auth-intro');
const signInForm = document.getElementById('signin-form');
const signUpForm = document.getElementById('signup-form');
const forgotForm = document.getElementById('forgot-form');
const passwordResetForm = document.getElementById('reset-form');
const signOutButton = document.getElementById('signout-btn');
const studentForm = document.getElementById('student-form');
const tableBody = document.getElementById('student-table-body');
const noDataMsg = document.getElementById('no-data');
const recordsStatus = document.getElementById('records-status');
const editIdInput = document.getElementById('edit-id');
const saveBtn = document.getElementById('save-btn');
const cancelBtn = document.getElementById('cancel-btn');
const formHeading = document.getElementById('form-heading');
const formStatus = document.getElementById('form-status');
const studentFields = {
    firstName: document.getElementById('first-name'),
    lastName: document.getElementById('last-name'),
    fatherName: document.getElementById('father-name'),
    rollNumber: document.getElementById('roll-number'),
    contact: document.getElementById('contact-number'),
    gmail: document.getElementById('gmail-address'),
    address: document.getElementById('address'),
    department: document.getElementById('department')
};

document.querySelectorAll('[data-view-target]').forEach((button) => {
    button.addEventListener('click', (event) => {
        event.preventDefault();
        switchView(button.dataset.viewTarget);
    });
});

document.querySelectorAll('[data-auth-mode]').forEach((button) => {
    button.addEventListener('click', () => {
        if (button.dataset.authMode === 'forgot') {
            document.getElementById('forgot-email').value = document.getElementById('signin-email').value.trim();
        }
        showAuthMode(button.dataset.authMode);
    });
});

signInForm.addEventListener('submit', (event) => {
    runAuthForm(event, signInForm, async () => {
        const email = document.getElementById('signin-email').value.trim();
        let response;
        try {
            response = await apiRequest(API_ENDPOINTS.signIn, {
                method: 'POST',
                body: {
                    email,
                    password: document.getElementById('signin-password').value
                },
                authenticated: false
            });
        } catch (error) {
            if (error.code === 'ACCOUNT_NOT_FOUND') {
                document.getElementById('signup-email').value = email;
                document.getElementById('signin-password').value = '';
                showAuthMode('signup');
                setAuthStatus('No account exists for this email yet. Create an account to continue.');
                return;
            }
            throw error;
        }
        const session = saveAuthSession(response, email);
        preferredViewAfterSignIn = 'home';
        document.getElementById('signin-password').value = '';
        await showAuthenticatedApp(session.user, preferredViewAfterSignIn);
        setAuthStatus('');
    });
});

signUpForm.addEventListener('submit', (event) => {
    runAuthForm(event, signUpForm, async () => {
        preferredViewAfterSignIn = 'register';
        const email = document.getElementById('signup-email').value.trim();
        const password = document.getElementById('signup-password').value;
        const passwordConfirmation = document.getElementById('signup-password-confirm').value;

        if (password.length < MIN_PASSWORD_LENGTH) {
            throw new Error(`Choose a password with at least ${MIN_PASSWORD_LENGTH} characters.`);
        }
        if (password !== passwordConfirmation) {
            throw new Error('The passwords do not match.');
        }

        const response = await apiRequest(API_ENDPOINTS.signUp, {
            method: 'POST',
            body: { email, password },
            authenticated: false
        });
        const authData = unwrapResponse(response);
        const token = getAccessToken(authData);

        document.getElementById('signup-password').value = '';
        document.getElementById('signup-password-confirm').value = '';

        if (token) {
            const session = saveAuthSession(authData, email);
            preferredViewAfterSignIn = 'register';
            await showAuthenticatedApp(session.user, 'register');
            setAuthStatus('');
        } else {
            showAuthMode('signin');
            setAuthStatus('Account created. Follow any confirmation instructions, then sign in to add student information.');
        }
    });
});

forgotForm.addEventListener('submit', (event) => {
    runAuthForm(event, forgotForm, async () => {
        const email = document.getElementById('forgot-email').value.trim();
        await apiRequest(API_ENDPOINTS.forgotPassword, {
            method: 'POST',
            body: { email, redirectUrl: getRedirectUrl() },
            authenticated: false
        });
        setAuthStatus('If an account exists for that email, a password reset link has been sent.');
    });
});

passwordResetForm.addEventListener('submit', (event) => {
    runAuthForm(event, passwordResetForm, async () => {
        const password = document.getElementById('reset-password').value;
        const confirmation = document.getElementById('reset-password-confirm').value;

        if (!passwordResetToken) {
            throw new Error('This password reset link is missing its token. Request a new reset link.');
        }
        if (password.length < MIN_PASSWORD_LENGTH) {
            throw new Error(`Choose a password with at least ${MIN_PASSWORD_LENGTH} characters.`);
        }
        if (password !== confirmation) {
            throw new Error('The passwords do not match.');
        }

        await apiRequest(API_ENDPOINTS.resetPassword, {
            method: 'POST',
            body: { token: passwordResetToken, password },
            authenticated: false
        });
        passwordResetToken = null;
        passwordResetForm.reset();
        clearStoredSession();
        showAuthMode('signin');
        setAuthStatus('Your password has been updated. Sign in with your new password.');
    });
});

signOutButton.addEventListener('click', async () => {
    signOutButton.disabled = true;
    setRecordsStatus('');
    try {
        await apiRequest(API_ENDPOINTS.signOut, { method: 'POST' });
        clearStoredSession();
        showSignedOutView();
    } catch (error) {
        clearStoredSession();
        showSignedOutView();
        setAuthStatus(`Signed out on this device, but the API sign-out failed: ${error.message}`);
    } finally {
        signOutButton.disabled = false;
    }
});

studentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentUser) {
        setFormStatus('Sign in before saving student records.');
        return;
    }

    const studentData = Object.fromEntries(
        Object.entries(studentFields).map(([key, input]) => [key, input.value.trim()])
    );
    const editId = editIdInput.value;
    saveBtn.disabled = true;
    setFormStatus('');

    try {
        const student = {
            firstName: studentData.firstName,
            lastName: studentData.lastName,
            fatherName: studentData.fatherName,
            rollNumber: studentData.rollNumber,
            contact: studentData.contact,
            gmail: studentData.gmail,
            address: studentData.address,
            department: studentData.department
        };

        if (editId === '') {
            await apiRequest(API_ENDPOINTS.students.create, { method: 'POST', body: student });
        } else {
            await apiRequest(getStudentEndpoint('update', editId), { method: 'PUT', body: student });
        }

        resetForm();
        switchView('records');
        try {
            await loadStudents();
        } catch (error) {
            setRecordsStatus(`Student saved, but the list could not be refreshed: ${error.message}`);
        }
    } catch (error) {
        setFormStatus(`Could not save this student: ${error.message}`);
    } finally {
        saveBtn.disabled = false;
    }
});

tableBody.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) {
        return;
    }

    const student = students.find((record) => String(record.id) === button.dataset.studentId);
    if (!student) {
        setRecordsStatus('That student record is no longer available. Refresh the student list and try again.');
        return;
    }

    if (button.dataset.action === 'edit') {
        editStudent(student);
    } else if (button.dataset.action === 'delete') {
        await deleteStudent(student, button);
    }
});

cancelBtn.addEventListener('click', resetForm);

function getConfiguredApiBaseUrl() {
    const baseUrl = CONFIG.apiBaseUrl;
    if (typeof baseUrl !== 'string' || !baseUrl || baseUrl.includes('YOUR_')) {
        throw new Error('Set the API base URL in config.js before using account or student features.');
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(baseUrl);
    } catch {
        throw new Error('The API base URL in config.js is invalid.');
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('The API base URL must use HTTP or HTTPS.');
    }
    return `${baseUrl.replace(/\/+$/, '')}/`;
}

function getStoredAccessToken() {
    return localStorage.getItem(SESSION_TOKEN_KEY);
}

function clearStoredSession() {
    localStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(SESSION_USER_KEY);
    currentUser = null;
}

function unwrapResponse(response) {
    return response && typeof response === 'object' && 'data' in response
        ? response.data
        : response;
}

function getAccessToken(response) {
    const data = unwrapResponse(response);
    return data?.accessToken || data?.access_token || data?.token || '';
}

function saveAuthSession(response, fallbackEmail) {
    const data = unwrapResponse(response);
    const token = getAccessToken(data);
    if (typeof token !== 'string' || !token) {
        throw new Error('The API response did not include an access token.');
    }

    const user = data?.user && typeof data.user === 'object'
        ? data.user
        : { email: fallbackEmail };
    localStorage.setItem(SESSION_TOKEN_KEY, token);
    localStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
    return { token, user };
}

function getApiErrorMessage(payload, status) {
    const error = payload?.error;
    const message = payload?.message
        || (typeof error === 'string' ? error : error?.message)
        || payload?.detail
        || (typeof payload === 'string' ? payload : '');
    return message || `The API request failed with status ${status}.`;
}

async function apiRequest(endpoint, options = {}) {
    if (typeof endpoint !== 'string' || !endpoint.trim()) {
        throw new Error('An API endpoint is missing from config.js.');
    }

    const baseUrl = getConfiguredApiBaseUrl();
    const path = endpoint.replace(/^\/+/, '');
    const url = new URL(path, baseUrl);
    const headers = new Headers(options.headers || {});
    if (options.body !== undefined) {
        headers.set('Content-Type', 'application/json');
    }

    const token = options.authenticated === false ? '' : getStoredAccessToken();
    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }

    let response;
    try {
        response = await fetch(url, {
            method: options.method || 'GET',
            headers,
            body: options.body === undefined ? undefined : JSON.stringify(options.body)
        });
    } catch {
        throw new Error(`Cannot connect to ${baseUrl}. Start the backend with "node server.js" and verify that port 3000 is available.`);
    }
    const responseText = response.status === 204 ? '' : await response.text();
    let payload = null;
    if (responseText) {
        try {
            payload = JSON.parse(responseText);
        } catch {
            payload = responseText;
        }
    }

    if (!response.ok) {
        const message = getApiErrorMessage(payload, response.status);
        if (response.status === 401 && token) {
            clearStoredSession();
            showSignedOutView();
            setAuthStatus('Your session has expired. Please sign in again.');
        }
        const error = new Error(message);
        error.status = response.status;
        error.code = payload?.code || '';
        throw error;
    }
    return payload;
}

function getStudentEndpoint(action, studentId) {
    const configuredEndpoint = API_ENDPOINTS.students[action];
    if (typeof configuredEndpoint !== 'string' || !configuredEndpoint.trim()) {
        throw new Error(`The ${action} student endpoint is missing from config.js.`);
    }
    const encodedId = encodeURIComponent(studentId);
    return configuredEndpoint.includes(':id')
        ? configuredEndpoint.replace(':id', encodedId)
        : `${configuredEndpoint.replace(/\/+$/, '')}/${encodedId}`;
}

function getPasswordResetTokenFromUrl() {
    const url = new URL(window.location.href);
    const searchParams = url.searchParams;
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, '').replace(/^\?/, ''));
    const token = searchParams.get('token')
        || searchParams.get('reset_token')
        || hashParams.get('token')
        || hashParams.get('reset_token')
        || hashParams.get('access_token');
    if (token) {
        searchParams.delete('token');
        searchParams.delete('reset_token');
        window.history.replaceState(null, '', `${url.pathname}${searchParams.toString() ? `?${searchParams}` : ''}`);
    }
    return token;
}

function restoreAuthSession() {
    const token = getStoredAccessToken();
    if (!token) {
        return false;
    }

    let user;
    const storedUser = localStorage.getItem(SESSION_USER_KEY);
    if (storedUser) {
        try {
            user = JSON.parse(storedUser);
        } catch {
            clearStoredSession();
            setAuthStatus('Saved sign-in information could not be read. Please sign in again.');
            return false;
        }
    }
    if (!user || typeof user !== 'object') {
        user = {};
    }
    void showAuthenticatedApp(user, 'home');
    return true;
}

function initializeAuthentication() {
    passwordResetToken = getPasswordResetTokenFromUrl();
    if (passwordResetToken) {
        showAuthMode('reset');
        setAuthStatus('Set a new password for your account.');
        return;
    }

    if (!restoreAuthSession()) {
        setAuthStatus('');
    }
}

function getRedirectUrl() {
    return `${window.location.origin}${window.location.pathname}`;
}

async function runAuthForm(event, form, action) {
    event.preventDefault();
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    setAuthStatus('');

    try {
        await action();
    } catch (error) {
        setAuthStatus(error.message || 'The request failed. Please try again.');
    } finally {
        submitButton.disabled = false;
    }
}

function showAuthMode(mode) {
    const formByMode = {
        signin: signInForm,
        signup: signUpForm,
        forgot: forgotForm,
        reset: passwordResetForm
    };
    const selectedForm = formByMode[mode];
    if (!selectedForm) {
        throw new Error(`Unknown authentication screen: ${mode}`);
    }

    Object.entries(formByMode).forEach(([name, form]) => {
        form.classList.toggle('hidden', form !== selectedForm);
    });
    document.querySelector('.auth-tabs').classList.toggle('hidden', mode === 'forgot' || mode === 'reset');
    document.querySelectorAll('.auth-tab').forEach((tab) => {
        const active = tab.dataset.authMode === mode;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
    });

    if (mode === 'signin') {
        authHeading.textContent = 'Welcome back';
        authIntro.textContent = 'Sign in to view the shared student directory, or create an account to get started.';
    } else if (mode === 'signup') {
        authHeading.textContent = 'Create your account';
        authIntro.textContent = 'Create an account to securely add and manage your student records in the shared directory.';
    } else if (mode === 'forgot') {
        authHeading.textContent = 'Reset your password';
        authIntro.textContent = 'We will email you a secure link to choose a new password.';
    } else {
        authHeading.textContent = 'Choose a new password';
        authIntro.textContent = 'Set a new password for your account.';
    }
    setAuthStatus('');
}

function setAuthStatus(message) {
    authStatus.textContent = message;
}

function setRecordsStatus(message) {
    recordsStatus.textContent = message;
}

function setFormStatus(message) {
    formStatus.textContent = message;
}

async function showAuthenticatedApp(user, viewName) {
    currentUser = user;
    accountEmail.textContent = user.email || '';
    accountEmail.title = user.email || '';
    authView.classList.add('hidden');
    appShell.classList.remove('hidden');
    mainNav.classList.remove('hidden');
    switchView(viewName || 'home');

    try {
        await loadStudents();
    } catch (error) {
        setRecordsStatus(`Could not load student records: ${error.message}`);
    }
}

function showSignedOutView() {
    currentUser = null;
    students = [];
    tableBody.replaceChildren();
    accountEmail.textContent = '';
    signInForm.reset();
    signUpForm.reset();
    forgotForm.reset();
    passwordResetForm.reset();
    resetForm();
    setRecordsStatus('');
    mainNav.classList.add('hidden');
    appShell.classList.add('hidden');
    authView.classList.remove('hidden');
    showAuthMode('signin');
}

function switchView(viewName) {
    if (viewName === 'records') {
        document.querySelectorAll('[data-view-panel]').forEach((panel) => {
            panel.classList.toggle('hidden', panel.id !== 'home-view');
        });
        renderTable();
        requestAnimationFrame(() => {
            document.getElementById('student-list-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        return;
    }

    const targetView = document.getElementById(`${viewName}-view`);
    if (!targetView) {
        throw new Error(`Unknown page view: ${viewName}`);
    }

    document.querySelectorAll('[data-view-panel]').forEach((panel) => {
        panel.classList.toggle('hidden', panel !== targetView);
    });
}

async function loadStudents() {
    const response = await apiRequest(API_ENDPOINTS.students.list);
    const data = unwrapResponse(response);
    const studentRows = Array.isArray(data) ? data : data?.students;
    if (!Array.isArray(studentRows)) {
        throw new Error('The API response did not contain a student list.');
    }
    students = studentRows.map(normalizeStudent);
    setRecordsStatus('');
    renderTable();
}

function renderTable() {
    tableBody.replaceChildren();
    noDataMsg.classList.toggle('hidden', students.length > 0);

    students.forEach((student) => {
        const row = document.createElement('tr');
        const values = [
            student.id,
            student.rollNumber,
            [student.firstName, student.lastName].filter(Boolean).join(' '),
            student.fatherName,
            student.department,
            student.contact,
            student.gmail,
            student.address
        ];

        values.forEach((value) => {
            const cell = document.createElement('td');
            cell.textContent = value || '—';
            row.appendChild(cell);
        });

        const actionsCell = document.createElement('td');
        if (student.canEdit) {
            const actionGroup = document.createElement('div');
            actionGroup.className = 'action-group';
            actionGroup.append(
                createActionButton('edit', student.id, 'Edit', 'action-btn edit-btn'),
                createActionButton('delete', student.id, 'Delete', 'action-btn delete-btn')
            );
            actionsCell.appendChild(actionGroup);
        } else {
            actionsCell.textContent = 'View only';
            actionsCell.className = 'record-readonly';
        }
        row.appendChild(actionsCell);
        tableBody.appendChild(row);
    });
}

function normalizeStudent(student) {
    if (!student || typeof student !== 'object' || student.id === undefined || student.id === null) {
        throw new Error('A student record from the API is missing its ID.');
    }
    return {
        id: student.id,
        firstName: student.firstName ?? student.first_name ?? '',
        lastName: student.lastName ?? student.last_name ?? '',
        fatherName: student.fatherName ?? student.father_name ?? '',
        rollNumber: student.rollNumber ?? student.roll_number ?? '',
        contact: student.contact ?? '',
        gmail: student.gmail ?? '',
        address: student.address ?? '',
        department: student.department ?? '',
        canEdit: student.canEdit === true
    };
}

function createActionButton(action, studentId, label, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.action = action;
    button.dataset.studentId = String(studentId);
    button.textContent = label;
    return button;
}

function editStudent(student) {
    editIdInput.value = String(student.id);
    Object.entries(studentFields).forEach(([key, input]) => {
        input.value = student[key] || '';
    });

    formHeading.textContent = `Update Student (ID: ${student.id})`;
    saveBtn.textContent = 'Update Student';
    cancelBtn.classList.remove('hidden');
    setFormStatus('');
    switchView('register');
}

async function deleteStudent(student, button) {
    const studentName = [student.firstName, student.lastName].filter(Boolean).join(' ') || 'this student';
    if (!confirm(`Are you sure you want to delete Student ID ${student.id} (${studentName})?`)) {
        return;
    }

    button.disabled = true;
    setRecordsStatus('');
    try {
        await apiRequest(getStudentEndpoint('delete', student.id), { method: 'DELETE' });
    } catch (error) {
        setRecordsStatus(`Could not delete this student: ${error.message}`);
        button.disabled = false;
        return;
    }
    try {
        await loadStudents();
    } catch (error) {
        setRecordsStatus(`Student deleted, but the list could not be refreshed: ${error.message}`);
    }
}

function resetForm() {
    studentForm.reset();
    editIdInput.value = '';
    formHeading.textContent = 'Student Registration';
    saveBtn.textContent = 'Register Student';
    cancelBtn.classList.add('hidden');
    setFormStatus('');
}

initializeAuthentication();
