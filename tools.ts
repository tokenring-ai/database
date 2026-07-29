import describeTable from "./tools/describeTable.ts";
import executeSql from "./tools/executeSql.ts";
import listTables from "./tools/listTables.ts";
import selectRows from "./tools/selectRows.ts";
import showSchema from "./tools/showSchema.ts";

export default [executeSql, showSchema, listTables, describeTable, selectRows];
