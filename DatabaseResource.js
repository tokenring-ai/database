import { Resource } from "@token-ring/registry";

export default class DatabaseResource extends Resource {
	static constructorProperties = {
		host: {
			type: "string",
			required: true,
			description: "Database server host address",
		},
		port: {
			type: "number",
			required: false,
			description: "Database server port",
		},
		user: {
			type: "string",
			required: true,
			description: "Username for database authentication",
		},
		password: {
			type: "string",
			required: true,
			description: "Password for database authentication",
		},
		databaseName: {
			type: "string",
			required: false,
			description: "Default database name to connect to",
		},
	};

	constructor({ host, port, user, password, databaseName }) {
		super();
		if (!host) {
			throw new Error("DatabaseResource requires a host.");
		}
		if (!user) {
			throw new Error("DatabaseResource requires a user.");
		}
		if (!password) {
			throw new Error("DatabaseResource requires a password.");
		}

		this.host = host;
		this.port = port;
		this.user = user;
		this.password = password;
		this.databaseName = databaseName;
	}

	/**
	 * Executes an SQL query.
	 * @abstract
	 * @param {string} sqlQuery - The SQL query string.
	 * @param {object} [params] - Optional parameters for the query.
	 * @returns {Promise<object>} The query result.
	 * @throws {Error} If the method is not implemented by the subclass.
	 */
	async executeSql(sqlQuery, params) {
		throw new Error("Method 'executeSql()' must be implemented.");
	}

	/**
	 * Lists all databases accessible by the connection.
	 * @abstract
	 * @returns {Promise<string[]>} A list of database names.
	 * @throws {Error} If the method is not implemented by the subclass.
	 */
	async listDatabases() {
		throw new Error("Method 'listDatabases()' must be implemented.");
	}

	/**
	 * Shows the schema for all tables in a given database.
	 * @abstract
	 * @param {string} databaseName - The name of the database.
	 * @returns {Promise<object|string>} The schema definition for all tables.
	 * @throws {Error} If the method is not implemented by the subclass.
	 */
	async showSchema(databaseName) {
		throw new Error("Method 'showSchema(databaseName)' must be implemented.");
	}

	getHost() {
		return this.host;
	}

	getPort() {
		return this.port;
	}

	getUser() {
		return this.user;
	}

	getPassword() {
		return this.password;
	}

	getDatabaseName() {
		return this.databaseName;
	}

	async start(registry) {
		console.log(`${this.constructor.name} starting`);
	}

	async stop(registry) {
		console.log(`${this.constructor.name} stopping`);
	}

	async status(registry) {
		return {
			active: true,
			service: this.constructor.name,
		};
	}
}
