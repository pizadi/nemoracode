import { helper } from "./util";

interface Friend {
    greet(): string;
}

export class Greeter implements Friend {
    greet(): string {
        return helper(this);
    }
}
