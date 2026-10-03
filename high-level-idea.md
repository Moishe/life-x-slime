# Life x Physarum

I'd like to explore a confluence of two things I've been working on for a long time:

  * conway's life, and ways to identify individual clusters of cells as "organisms"
  * slime mold/physarum algorithms, and colonies that have affinity for their own HSV space
  (each actor has an HSV value, seeks that HSV value, leaves an HSV value "pheromone" that
  blends with the HSV pheromone at that location)

I've got some exploration of the former in ~/src/life-ambient (and I will eventually want to take this merged project's output and use it to generate MIDI), and the latter in ~/src/Particles.

This project will run two simulations in parallel, at two different levels of resolution and two different pacings and in two different layers.

Let's start with a 128x128 Life simulation. That simulation's clock will tick once per second.

Simultaneously, we'll run a 2048x2048 Physarum simulation. That simulation's clock will tick 30 times per second. I think we'll need to experiment to find the max number of actors but let's start with 2^16.

This should run in the web browser with WebGPU.

The Life simulation will "leak" into the Physarum simulation: each newly-born "cell" in the life board will spawn a certain number of actors with the Life organism's color on the physarum field.

The Life organism's colors can be chosen randomly, let's start with a palette of 8 visually distinct colors.

Use the blending algorithm from ~/src/Particles for the Physarum simulation.

The user should be able to control the opacity of the Life board and the Physarum board individually.

The user should be able to place patterns in the Life board (like in the ~/src/life-ambient project). They don't need to place actors on the Physarum simulation.

The user should be able to control the parameters of the Physarum simulation, with the same parameters that exist in ~/src/Particles.