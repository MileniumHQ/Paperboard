(() => {
    const year = document.querySelector("[data-year]");
    if (year) year.textContent = `© ${new Date().getFullYear()} Milenium LLC`;
})();
