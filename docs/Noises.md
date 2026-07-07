**Advanced Mathematical & Gradient**

- **Perlin Noise (Classic & Improved):** The original industry standard; creates smooth, cloudy transitions using a lattice of random gradients.
- **Hermite Noise:** A smoother alternative to Value noise that uses cubic Hermite interpolation for more organic, rounded shapes.
- **Periodic Noise (psrdnoise):** Specialized noise that can be tiled perfectly (seamless) and supports rotating gradients for animated effects.
- **Worley F2-F1:** A variation of Voronoi where you subtract the closest point distance from the second closest, creating thin "vein" or "crack" structures.

**Physics & Stochastic (Sampling)**

- **Gaussian Noise:** Random noise where values follow a normal distribution (bell curve); looks more "natural" and less harsh than standard white noise.
- **Poisson Noise (Shot Noise):** Simulates the statistical nature of light particles (photons); essential for realistic low-light video effects.
- **Blue Noise (Dither):** High-frequency noise that is extremely useful for masking banding in gradients or for high-quality dithering.
- **White Noise (Uniform):** Basic RNG per pixel; the foundation for many classic video "snow" effects. 

**Temporal & Motion (Video Specific)**

- **Radial Noise:** Noise that pulsates or radiates from a center point, ideal for "tunnel" or "warp" effects.
- **4D Noise:** Standard noise (Simplex/Perlin) with a 4th dimension (time), allowing for perfectly smooth, non-looping evolution of textures.
- **VCR/Tape Noise:** A combination of horizontal tracking errors, local luminance "smearing," and periodic signal dropouts. 

**Fractal & Multi-Scale**

- **Billowed Noise:** Uses the absolute value of a noise function to create "bubbly" or "billowing" shapes, often used for clouds or steam.
- **Sparse Convolution Noise:** Created by scattering many small "kernels" (like circles or stars) randomly, useful for starfields or bokeh-like backgrounds. 

Here are a few visually and mathematically interesting types of noise:

- **Perlin Noise**
    - **The Math:** Invented by Ken Perlin, it is a gradient noise function. It interpolates between pseudo-random gradient vectors at the vertices of a grid.
    - **The Aesthetic:** It generates smooth, organic, wave-like patterns rather than harsh, blocky pixels. It is the industry standard for mimicking natural phenomena like clouds, terrain, and fire.
- **Simplex Noise**
    - **The Math:** Also created by Ken Perlin to improve upon Perlin noise, it uses a grid of simplexes (triangles in 2D, tetrahedrons in 3D) instead of hypercubes, reducing directional artifacts and computational overhead.
    - **The Aesthetic:** Offers an even more natural, organic flow than standard Perlin noise. It is often used in generative art for fluid simulations and organic textures.
- **White Noise**
    - **The Math:** Based on a uniform probability distribution where every single pixel's value is completely independent and random.
    - **The Aesthetic:** Results in a harsh "snow" or static effect. Because it lacks spatial correlation, it is visually chaotic and rarely used raw, though it can be mathematically useful for dithering or grainy post-processing filters.
- **Voronoi Noise (Cellular Noise)**
    - **The Math:** Based on partitioning a space into regions based on distances to a specific set of seed points (the Voronoi diagram).
    - **The Aesthetic:** Produces segmented, cell-like shapes. You can easily map this into an interactive tool to create organic patterns like reptile scales, dry cracked earth, or crystalline structures.
- **Fractal Brownian Motion (fBm)**
    - **The Math:** Takes multiple layers of noise (called "octaves") and scales them down in amplitude (a process called fractional scaling).
    - **The Aesthetic:** Introduces deep self-similarity. This is the math behind hyper-realistic procedural textures, creating complex, rough surfaces like mountainous terrain and intricate fractal art.
- 
- Here are five additional types of noise, each with distinct mathematical behaviors and visual outcomes:

- **Blue Noise**
    - **The Math:** Unlike white noise (which contains all frequencies equally), Blue noise consists almost entirely of **high-frequency energy** with zero low-frequency components. It is constructed using error-diffusion or dart-throwing algorithms (like Poisson Disk Sampling) to keep points randomly distributed but strictly separated by a minimum distance.
    - **The Aesthetic:** Visually, it looks completely uniform and organic, avoiding the awkward clumping or gaping holes seen in white noise. It is highly prized in computer graphics for dithered shading, grain effects, and stippled art because it mimics the natural distribution of cells in the human retina.
- **Value Noise**
    - **The Math:** Often confused with Perlin noise, Value noise is mathematically simpler. It assigns random values strictly to the coordinates of a grid, then uses bilinear or bicubic interpolation to smoothly blend the spaces between those points.
    - **The Aesthetic:** Because it interpolates raw values rather than gradient directions, it looks like a blockier, more pixelated version of Perlin noise. It creates rigid, checkerboard-like macro structures that work well for retro, voxel-based terrain or synthetic grid-like distortions.
- **Worley Noise (Cellular/Alligator Noise)**
    - **The Math:** A close relative of Voronoi noise, invented by Steven Worley. Instead of coloring the cells based on which seed point is closest, Worley noise maps values based on the **exact linear distance** to the \(n\)-th closest seed point (e.g., the distance to the 2nd or 3rd closest point).
    - **The Aesthetic:** It generates a Web-like, biological, or crystalline texture. If you invert the distance functions, you get "Alligator noise," which creates sharp, jagged, scale-like peaks ideal for procedural water ripples, reptilian skin, or heavily weathered metal.
- **Wavelet Noise**
    - **The Math:** Developed as an alternative to Perlin noise to fix "aliasing" (stair-stepping artifacts). It is generated in the frequency domain using a mathematical wavelet transform, creating a band-limited noise field.
    - **The Aesthetic:** It offers perfect, lossless detail when zooming in or downscaling, without losing definition or turning into a blurry mess. It is incredibly useful for rendering high-fidelity cinematic effects like smoke, dust clouds, and fluid simulations.
- **Curl Noise**
    - **The Math:** This is a vector noise field created by taking the **curl** (a vector calculus operator) of a standard scalar noise field like Perlin or Simplex noise. Mathematically, it guarantees a divergence-free field (\(\nabla \cdot \mathbf{v} = 0\)).
    - **The Aesthetic:** Because the field has zero divergence, particles moving through it will never clump together or disappear into a sinkhole. It creates mesmerizing, perfectly fluid, non-turbulent currents. It is the gold standard for generating realistic smoke trails, magnetic fields, and complex particle flows in generative art. [[1](https://caseymuratori.com/blog_0010), [2](https://blog.demofox.org/2017/10/25/transmuting-white-noise-to-blue-red-green-purple/), [3](https://blog.demofox.org/2018/01/30/what-the-heck-is-blue-noise/), [4](https://blog.voxagon.se/2018/12/07/the-importance-of-good-noise.html), [5](https://www.reddit.com/r/proceduralgeneration/comments/19elmex/different_kinds_of_3d_noise/), [6](https://rtouti.github.io/graphics/perlin-noise-algorithm), [7](https://gameidea.org/2023/12/16/noise-functions/), [8](https://www.reddit.com/r/vfx/comments/1o1u7zs/what_are_the_best_tips_for_choosing_the_most/), [9](https://en.wikipedia.org/wiki/Wavelet_noise)]

https://thebookofshaders.com/