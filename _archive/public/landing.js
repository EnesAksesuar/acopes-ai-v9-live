await fetch("/api/visit", { method: "POST" });
const form = document.querySelector("#waitlistForm");
const status = document.querySelector("#waitlistStatus");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const response = await fetch("/api/waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  status.textContent = response.ok ? "You are on the beta waitlist." : "Could not join right now.";
  if (response.ok) form.reset();
});
