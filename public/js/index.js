gsap.from(".logo", { opacity: 0, x: -50, duration: 1 });
gsap.from(".menu li", { opacity: 0, y: -20, stagger: 0.1, delay: 0.5 });
gsap.from(".nav-icons .icon", { opacity: 0, x: 30, delay: 1 });

gsap.from(".hero-left", { opacity: 0, x: -100, delay: 0.7, duration: 1 });
gsap.from(".hero-center", { opacity: 0, y: 50, delay: 1.2, duration: 1 });
gsap.from(".hero-right", { opacity: 0, x: 100, delay: 1.5, duration: 1 });
