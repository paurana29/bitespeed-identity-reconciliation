import { Request, Response } from "express";
import { findOrCreateContact } from "./contactService";

export const identify = async (req: Request, res: Response) => {
    const { email, phoneNumber } = req.body;
    const result = await findOrCreateContact(email, phoneNumber);
    if(result.error || !result.primaryContact){
        return res.status(400).json({error: result.error});
    }

    const { primaryContact, secondaryContacts } = result;

    const response = {
        contact: {
            primaryContactId: primaryContact.id,
            emails: [primaryContact.email, ...(secondaryContacts ? secondaryContacts.map(contact => contact.email).filter(email => email !== null) : [])],
            phoneNumbers: [primaryContact.phonenumber, ...(secondaryContacts ? secondaryContacts.map(contact => contact.phonenumber).filter(phone => phone !== null) : [])],
            secondaryContactIds: (secondaryContacts ? secondaryContacts.map(contact => contact.id) : [])
        }
    };

    res.status(200).json(response);
};
