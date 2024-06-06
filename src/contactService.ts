import { pool } from './db';

interface Contact {
    id: number;
    phonenumber: string | null;
    email: string | null;
    linkedid: number | null;
    linkprecedence: 'primary' | 'secondary';
    createdat: Date;
    updatedat: Date;
    deletedat: Date | null;
}

export const findOrCreateContact = async (email?: string, phonenumber?: string) => {
    //if email and phonenumber both are blank, error!
    if(!email && !phonenumber) {
        return {
            error: "QUERY ERROR: Both email and phonenumber cannot be NULL"
        };
    }

    //prevents the db from crashing incase of spurious phonenumber
    //ideally, similar check should also be present for email.length > 255
    if(phonenumber && phonenumber.length > 15){
        return {
            error: "ERROR: Phonenumber length must be <= 15"
        };
    }

    const client = await pool.connect();
    try {
        //fixed bug. previous query would also look up rows matching null email/phonenumber,
        let query = 'SELECT * FROM Contact WHERE ';
        let params: (string | null)[] = [];
        if (email) {
            query += 'email = $1';
            params.push(email);
        }
        if (phonenumber) {
            if (params.length > 0) query += ' OR ';
            query += 'phonenumber = $' + (params.length + 1);
            params.push(phonenumber);
        }
        query += ' ORDER BY createdat ASC';

        let contacts = await client.query<Contact>(query, params);

        let countEmail = 0;
        let countPhone = 0;

        //if the count remains zero, the email/phone has been entered for the first time
        //we have new info, needs to be added to the db
        contacts.rows.forEach(contact => {
            if (contact.email === email) {
                countEmail++;
            }
            if (contact.phonenumber === phonenumber) {
                countPhone++;
            }
        });

        //the db has seen either the email or phonenumber before
        if(contacts.rows.length>0) {
            let primaryContacts = contacts.rows.filter(contact => contact.linkprecedence === 'primary');
            //this was changed to a set because the entire record is not needed, we can only make do with `unique` ids, and in the end,
            //query the database for the records. saves unnecessary space, and easier to work with instead of doing rows[x].id everytime
            //set also works quite well with the controller logic, we do not want repeated redundancies in the response
            let secondaryContactsSet = new Set<number>(contacts.rows.filter(contact => contact.linkprecedence === 'secondary').map(contact => contact.id));

            //it's possible that the initial query only returns secondary records, in this case, we need to go through the linkedids of the seconadries to reach the
            //primary records
            if(primaryContacts.length === 0) {
                let secondaryLinkedIds = new Set<number>(contacts.rows.filter(contact => contact.linkprecedence === 'secondary' && contact.linkedid !== null).map((contact: Contact) => contact.linkedid as number));
                
                //this shouldn't be possible in a safe db which is consistent, error returned incase of inconsistent state
                if(secondaryLinkedIds.size === 0) {
                    return {
                        error: "DB ERROR: Primary Contact Not Found"
                    }
                }

                //primary is the array of all the possible primary records incase we only found secondary records in our initial query
                const primary = [];
                for (const id of secondaryLinkedIds.values()) {
                    const result = await client.query<Contact>(
                        'SELECT * FROM Contact WHERE id = $1',
                            [id]
                    );
                    primary.push(result.rows[0]);
                }
                
                //primary array is expected to be sorted by time because primaryContact is ultimately primary[0]
                primary.sort((a, b) => new Date(a.createdat).getTime() - new Date(b.createdat).getTime());
                primaryContacts = primary;                
            }

            const primaryContact = primaryContacts[0];
            //this is where the count logic is used. if we have a new entry for either email/phonenumber, add 
            //secondary record to the database
            if ((email !== "" && countEmail === 0) || (phonenumber !== "" && countPhone === 0)) {
                const newContact = await client.query<Contact>(
                    'INSERT INTO Contact (email, phonenumber, linkprecedence, linkedid) VALUES ($1, $2, $3, $4) RETURNING *',
                    [email, phonenumber, 'secondary', primaryContact.id]
                );
                secondaryContactsSet.add(newContact.rows[0].id);
            }

            //primaryContact is the new primary, the other primaries, if encountered, must be set to secondary, and their linkedid
            //must point to the primaryContact we have found
            const oldPrimary = [];
            for(let i=1; i<primaryContacts.length; ++i) {
                oldPrimary.push(client.query(
                    'UPDATE Contact SET linkedid = $1, linkprecedence = $2 WHERE id = $3 RETURNING *',
                        [primaryContact.id, 'secondary', primaryContacts[i].id]
                ));
            };
            const oldPrimaryNowSecondary = await Promise.all(oldPrimary);

            //secondaries of all old primaries must also declare their new primary to be `primaryContact`
            //the var names are getting too big lmao fix asap
            const secondariesOfOldPrimaries = [];
            for(let i=1; i<primaryContacts.length; ++i) {
                secondariesOfOldPrimaries.push(client.query(
                    'UPDATE Contact SET linkedid = $1 WHERE linkedid = $2 RETURNING *',
                        [primaryContact.id, primaryContacts[i].id]
                ));
            };
            await Promise.all(secondariesOfOldPrimaries);

            //db updated but resp still the same, moving this function here should do the trick
            const linkedToPrimary = await client.query<Contact>(
                'SELECT * FROM Contact WHERE linkedid = $1',
                    [primaryContact.id]
            );
            linkedToPrimary.rows.forEach(row => {
                secondaryContactsSet.add(row.id);
            });

            //okay this might be redundant? if i iterate over secondaries of all old primaries,
            //further iteration is probably not required. 
            //added clause linkedid != $1 to avoid unnecessary updation
            const updatesSecondary = [];
            for(let id of secondaryContactsSet) {
                updatesSecondary.push(client.query(
                    'UPDATE Contact SET linkedid = $1 WHERE id = $2 and linkedid <> $1',
                        [primaryContact.id, id]
                ));
            };
            await Promise.all(updatesSecondary);

           //new secondary ids added to the set
           oldPrimaryNowSecondary.forEach(updatedContact => {
                secondaryContactsSet.add(updatedContact.rows[0].id);
            });

            //query the database to return the records from the ids stored in the set
            let secondaryContacts = [];
            for (let id of secondaryContactsSet) {
                const result = await client.query<Contact>('SELECT * FROM Contact WHERE id = $1', [id]);
                if (result.rows.length > 0) {
                    secondaryContacts.push(result.rows[0]);
                }
            }

            return {
                primaryContact,
                secondaryContacts
            };
        } else {
            //else block runs when both email and phonenumber seen for the first time
            const newContact = await client.query<Contact>(
                'INSERT INTO Contact (email, phonenumber, linkprecedence) VALUES ($1, $2, $3) RETURNING *',
                [email, phonenumber, 'primary']
            );

            return {
                primaryContact: newContact.rows[0],
                secondaryContacts: []
            };
        }
    }
    finally {
        client.release();
    }
};
