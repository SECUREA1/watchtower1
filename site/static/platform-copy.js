(() => {
  if (!document.body || document.body.dataset.noPlatformCopy === 'true') return;

  const styleId = 'platform-copywriting-style';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .platform-copywriting {
        margin: 14px auto 18px;
        max-width: 1100px;
        border: 1px solid rgba(227, 194, 122, 0.28);
        background: linear-gradient(135deg, rgba(201,138,58,0.2), rgba(184,107,59,0.14));
        color: inherit;
        border-radius: 14px;
        padding: 14px 16px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.16);
      }
      .platform-copywriting h2 {
        margin: 0 0 6px;
        font-size: 1rem;
        letter-spacing: .01em;
      }
      .platform-copywriting p {
        margin: 0;
        line-height: 1.45;
        opacity: .95;
        font-size: .95rem;
      }
      .platform-copywriting strong { font-weight: 700; }
      .platform-copywriting small { opacity: .82; }
    `;
    document.head.appendChild(style);
  }

  if (document.querySelector('.platform-copywriting')) return;

  const copy = document.createElement('section');
  copy.className = 'platform-copywriting';
  copy.setAttribute('aria-label', 'Platform messaging');
  copy.innerHTML = `
    <h2>One platform. Every experience.</h2>
    <p>
      <strong>Watchtower</strong> unifies automation, live operations, telematics, security, and interactive experiences
      into a single command surface—so teams can move from insight to action without switching tools.
      <small>Built for reliable control, clear decisions, and real-time collaboration.</small>
    </p>
  `;

  const firstElement = Array.from(document.body.children).find((el) => el.tagName !== 'SCRIPT');
  if (firstElement) {
    document.body.insertBefore(copy, firstElement);
  } else {
    document.body.appendChild(copy);
  }
})();
