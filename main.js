import './style.css';

document.addEventListener('DOMContentLoaded', () => {
    
    // 0. Inject Home Page Gallery (Latest Work)
    const homeGrid = document.getElementById('latest-work-grid');
    if (homeGrid) {
        const latestWork = [
            '<div class="grid-item wide"><img src="/assets/Finale.jpg" alt="Track Finale" loading="lazy" decoding="async" class="art-image"></div>',
             '<div class="grid-item tall"><img src="/assets/Hunt.jpg" alt="Athlete Hunt" loading="lazy" decoding="async" class="art-image"></div>',
              '<div class="grid-item"><img src="/assets/RelayAnchor.jpg" alt="Relay Anchor" loading="lazy" decoding="async" class="art-image"></div>',
               '<div class="grid-item tall"><img src="/assets/DSC01498.jpg" alt="Track & Field" loading="lazy" decoding="async" class="art-image"></div>'
        ];
        homeGrid.innerHTML = latestWork.join('');
    }
    
    // 1. Lightbox Logic
    const createLightbox = () => {
        const lightbox = document.createElement('div');
        lightbox.id = 'lightbox';
        
        lightbox.innerHTML = `
            <button class="lightbox-close">&times;</button>
            <img src="" alt="Lightbox Image">
        `;
        document.body.appendChild(lightbox);
        return lightbox;
    };

    const artImages = document.querySelectorAll('.art-image');
    
    if (artImages.length > 0) {
        const lightbox = createLightbox();
        const lightboxImg = lightbox.querySelector('img');
        const closeBtn = lightbox.querySelector('.lightbox-close');

        // Open Lightbox
        artImages.forEach(img => {
            img.style.cursor = 'zoom-in'; // UX enhancement
            
            img.addEventListener('click', (e) => {
                lightboxImg.src = e.target.src;
                lightboxImg.alt = e.target.alt;
                lightbox.classList.add('active');
                document.body.style.overflow = 'hidden'; // Stop background scroll
            });
        });

        // Close Lightbox functions
        const closeLightbox = () => {
            lightbox.classList.remove('active');
            document.body.style.overflow = '';
            setTimeout(() => {
                lightboxImg.src = '';
            }, 150); // Clear image AFTER fade out transition
        };

        closeBtn.addEventListener('click', closeLightbox);
        
        lightbox.addEventListener('click', (e) => {
            // Close if clicking outside the image
            if (e.target !== lightboxImg) {
                closeLightbox();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && lightbox.classList.contains('active')) {
                closeLightbox();
            }
        });
    }

    // 3. Copy Email Logic
    const copyBtns = document.querySelectorAll('.copy-email-btn');
    if (copyBtns.length > 0) {
        copyBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const email = btn.getAttribute('data-email');
                navigator.clipboard.writeText(email).then(() => {
                    const msgSpan = btn.querySelector('.copy-msg');
                    msgSpan.textContent = 'COPIED!';
                    msgSpan.classList.add('show');
                    
                    setTimeout(() => {
                        msgSpan.classList.remove('show');
                    }, 2000);
                });
            });
        });
    }

});
