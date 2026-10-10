/* =====================================================
   SIGNUP  (single step, no OTP)
   Submitting the form sends the details to the backend, which
   creates the account. We show a success message and
   send the user to the login page.
===================================================== */

function $(id) {
    return document.getElementById(id);
}

function showError(message) {
    $("formInfo").hidden = true;
    $("formError").textContent = message;
    $("formError").hidden = false;
}

function clearMessages() {
    $("formError").hidden = true;
    $("formInfo").hidden = true;
}

function signup(event) {

    event.preventDefault();
    clearMessages();

    const fullName = $("fullName").value.trim();
    const email = $("email").value.trim();
    const password = $("password").value;
    const confirmPassword = $("confirmPassword").value;
    const branch = $("branch").value;
    const year = $("year").value;

    if (!fullName) {
        showError("Please enter your full name.");
        return;
    }

    if (!email) {
        showError("Please enter your college email.");
        return;
    }

    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        showError("Password must be at least 8 characters and include a letter and a number.");
        return;
    }

    if (password !== confirmPassword) {
        showError("Passwords do not match.");
        return;
    }

    const button = $("signupBtn");
    Api.busy(button, true, "Creating account...");

    Api.post("/api/auth/signup", {
        fullName: fullName,
        email: email,
        password: password,
        branch: branch,
        year: year
    })
        .then(function () {
            $("formInfo").textContent = "Account created successfully! Redirecting to login...";
            $("formInfo").hidden = false;
            setTimeout(function () {
                window.location.href = "login.html";
            }, 1500);
        })
        .catch(function (err) {
            Api.busy(button, false);
            showError(err.message);
        });
}

document.addEventListener("DOMContentLoaded", function () {
    $("signupForm").addEventListener("submit", signup);
});