"""AVISHKAR engine: the numerical service behind the platform (planning, forecasting, simulation).

Stateless by design: every request carries the data it needs and the answer says how it was reached. No database access, no
network calls. The TypeScript API (platform/api) assembles the inputs from real data and labels the outputs; this package
only does the arithmetic, and says plainly when it cannot.
"""

__version__ = "0.1.0"
