import numpy as np
from scipy.integrate import quad, simpson
def f(x):
	return x**2
points = [10, 50,100, 500, 1000, 5000]
for n in points:
	res, _ = quad(f, 0, 2)
	x = np.linspace(0, 2, n)
	y = f(x)
	trap = np.trapezoid(y, x)
	simp = simpson(y, x)
	print(res)
	print(trap)
	print(simp)
