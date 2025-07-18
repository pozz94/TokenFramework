const wrapInContext = (fn, context) => {
	if (!context || !Object.keys(context).length) return fn;
	return (...args) => {
		// Store original values
		const originalValues = {};
		Object.keys(context).forEach(key => {
			if (key in window) originalValues[key] = window[key];
		});

		// Add context properties
		Object.assign(window, context);

		let result;
		try {
			result = fn(...args);
		} finally {
			// Restore original state
			Object.keys(context).forEach(key => {
				if (key in originalValues) {
					window[key] = originalValues[key];
				} else {
					delete window[key];
				}
			});
		}
		return result;
	};
};

export {
    wrapInContext
}