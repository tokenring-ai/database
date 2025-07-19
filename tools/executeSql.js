import DatabaseResource from "../DatabaseResource.js";
import { z } from "zod";

export async function execute(
	{ databaseName, sqlQuery, queryParams },
	registry,
) {
	const resource = registry.requireFirstServiceByType(DatabaseResource);

	if (!sqlQuery) {
		return { error: "sqlQuery is required" };
	}
	// databaseName for connecting to a specific DB is now handled by the resource's executeSql method if needed,
	// or by the SQL query itself (e.g. USE some_db;).
	// The `params` object in `resource.executeSql(sqlQuery, params)` can be used for more advanced cases,
	// like passing values for prepared statements or specifying a database for the connection.

	try {
		// Construct the params object for the resource's executeSql method
		const executionParams = {
			// If databaseName is provided by the tool's arguments, pass it along.
			// This allows the resource's executeSql method to decide how to use it (e.g., connect to this DB).
			databaseName: databaseName,
			// queryParams could be an object containing values for prepared statements, e.g., { values: [...] }
			// Adjust based on how `resource.executeSql` is designed to handle them.
			...(queryParams && typeof queryParams === "object" ? queryParams : {}),
		};

		return await resource.executeSql(sqlQuery, executionParams);
	} catch (error) {
		console.error("Error executing SQL query via resource:", error);
		return {
			error: `Failed to execute SQL query via resource: ${error.message}`,
		};
	}
}

export const description =
	"Executes an arbitrary SQL query on a database using the DatabaseResource. WARNING: Use with extreme caution as this can modify or delete data.";

export const parameters = z.object({
	databaseName: z
		.string()
		.optional()
		.describe(
			"Optional: The name of the database to target. May also be specified in the SQL query.",
		),
	sqlQuery: z.string().describe("The SQL query to execute."),
	queryParams: z
		.object({})
		.passthrough()
		.optional()
		.describe(
			"Optional: Parameters for the SQL query, for prepared statements or specific connection needs.",
		),
});
